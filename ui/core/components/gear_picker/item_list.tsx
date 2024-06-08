import clsx from 'clsx';
import tippy from 'tippy.js';
import { ref } from 'tsx-vanilla';

import { SortDirection } from '../../constants/other';
import { EP_TOOLTIP } from '../../constants/tooltips';
import { setItemQualityCssClass } from '../../css_utils';
import { IndividualSimUI } from '../../individual_sim_ui';
import { Player } from '../../player';
import { Class, ItemQuality, ItemRandomSuffix, ItemSlot, ItemSpec } from '../../proto/common';
import { DatabaseFilters, UIEnchant, UIItem, UIItem_FactionRestriction, UIRune } from '../../proto/ui';
import { ActionId } from '../../proto_utils/action_id';
import { getUniqueEnchantString } from '../../proto_utils/enchants';
import { EquippedItem } from '../../proto_utils/equipped_item';
import { professionNames, REP_LEVEL_NAMES } from '../../proto_utils/names';
import { Sim } from '../../sim';
import { SimUI } from '../../sim_ui';
import { EventID, TypedEvent } from '../../typed_event';
import { formatDeltaTextElem } from '../../utils';
import { FiltersMenu } from '../filters_menu';
import { makeShow1hWeaponsSelector, makeShow2hWeaponsSelector, makeShowEPValuesSelector } from '../other_inputs';
import Toast from '../toast';
import { Clusterize } from '../virtual_scroll/clusterize';
import { SelectorModalTabs } from './selector_modal';

export interface ItemData<T> {
	item: T;
	name: string;
	id: number;
	actionId: ActionId;
	quality: ItemQuality;
	phase: number;
	baseEP: number;
	ignoreEPFilter: boolean;
	onEquip: (eventID: EventID, item: T) => void;
}

interface ItemDataWithIdx<T> {
	idx: number;
	data: ItemData<T>;
}

export interface GearData {
	equipItem: (eventID: EventID, equippedItem: EquippedItem | null) => void;
	getEquippedItem: () => EquippedItem | null;
	changeEvent: TypedEvent<any>;
}

export type ItemListType = UIItem | UIEnchant | UIRune | ItemRandomSuffix;
enum ItemListSortBy {
	EP,
	ILVL,
}

export class ItemList<T extends ItemListType> {
	public id: string;
	public label: string;

	private listElem: HTMLElement;
	private slot: ItemSlot;
	private itemData: Array<ItemData<T>>;
	private itemsToDisplay: Array<number>;
	private currentFilters: DatabaseFilters;
	private searchInput: HTMLInputElement;
	private computeEP: (item: T) => number;
	private equippedToItemFn: (equippedItem: EquippedItem | null) => T | null | undefined;
	private gearData: GearData;
	private tabContent: Element;
	private onItemClick: (itemData: ItemData<T>) => void;
	private scroller: Clusterize;
	private sortBy = ItemListSortBy.ILVL;
	private sortDirection = SortDirection.DESC;

	private readonly simUI: SimUI;
	private readonly player: Player<any>;

	constructor(
		id: string,
		parent: HTMLElement,
		simUI: SimUI,
		currentSlot: ItemSlot,
		currentTab: SelectorModalTabs,
		player: Player<any>,
		label: string,
		gearData: GearData,
		itemData: Array<ItemData<T>>,
		computeEP: (item: T) => number,
		equippedToItemFn: (equippedItem: EquippedItem | null) => T | null | undefined,
		onRemove: (eventID: EventID) => void,
		onItemClick: (itemData: ItemData<T>) => void,
	) {
		this.id = id;
		this.label = label;
		this.simUI = simUI;
		this.player = player;
		this.itemData = itemData;
		this.computeEP = computeEP;
		this.equippedToItemFn = equippedToItemFn;
		this.onItemClick = onItemClick;

		this.slot = currentSlot;
		this.gearData = gearData;
		this.currentFilters = this.player.sim.getFilters();

		const selected = label === currentTab;

		const sortByIlvl = (event: MouseEvent) => {
			event.preventDefault();
			this.sort(ItemListSortBy.ILVL);
		};
		const sortByEP = (event: MouseEvent) => {
			event.preventDefault();
			this.sort(ItemListSortBy.EP);
		};

		const searchRef = ref<HTMLInputElement>();
		const epButtonRef = ref<HTMLButtonElement>();
		const filtersButtonRef = ref<HTMLButtonElement>();
		const showEpValuesRef = ref<HTMLDivElement>();
		const phaseSelectorRef = ref<HTMLDivElement>();
		const show1hWeaponRef = ref<HTMLDivElement>();
		const show2hWeaponRef = ref<HTMLDivElement>();
		const modalListRef = ref<HTMLUListElement>();
		const removeButtonRef = ref<HTMLButtonElement>();
		const compareLabelRef = ref<HTMLElement>();

		this.tabContent = (
			<div id={this.id} className={clsx('selector-modal-tab-pane tab-pane fade', selected && 'active show')}>
				<div className="selector-modal-filters">
					<input ref={searchRef} className="selector-modal-search form-control" type="text" placeholder="Search..." />
					{label === SelectorModalTabs.Items && (
						<button ref={filtersButtonRef} className="selector-modal-filters-button btn btn-primary">
							Filters
						</button>
					)}
					<div ref={phaseSelectorRef} className="selector-modal-phase-selector hide" />
					<div ref={show1hWeaponRef} className="sim-input selector-modal-boolean-option selector-modal-show-1h-weapons hide" />
					<div ref={show2hWeaponRef} className="sim-input selector-modal-boolean-option selector-modal-show-2h-weapons hide" />
					<div ref={showEpValuesRef} className="sim-input selector-modal-boolean-option selector-modal-show-ep-values" />
					<button ref={removeButtonRef} className="selector-modal-remove-button btn btn-danger">
						Unequip Item
					</button>
				</div>
				<div className="selector-modal-list-labels">
					<span className="item-label">
						<small>Item</small>
					</span>
					{label === SelectorModalTabs.Items && (
						<>
							<span className="source-label">
								<small>Source</small>
							</span>
							<span className="ilvl-label interactive" onclick={sortByIlvl}>
								<small>ILvl</small>
							</span>
						</>
					)}
					<span className="ep-label interactive" onclick={sortByEP}>
						<small>EP</small>
						<i className="fa-solid fa-plus-minus fa-2xs" />
						<button ref={epButtonRef} className="btn btn-link p-0 ms-1">
							<i className="far fa-question-circle fa-lg" />
						</button>
					</span>
					<span className="favorite-label" />
					<span ref={compareLabelRef} className="compare-label hide" />
				</div>
				<ul ref={modalListRef} className="selector-modal-list" />
			</div>
		);

		parent.appendChild(this.tabContent);

		if (this.label === SelectorModalTabs.Items) {
			this.bindToggleCompare(compareLabelRef.value!);
		}

		tippy(epButtonRef.value!, {
			content: EP_TOOLTIP,
		});

		if (
			label === SelectorModalTabs.Items &&
			(currentSlot === ItemSlot.ItemSlotMainHand || (currentSlot === ItemSlot.ItemSlotOffHand && player.getClass() === Class.ClassWarrior))
		) {
			makeShow1hWeaponsSelector(show1hWeaponRef.value!, player.sim);
			makeShow2hWeaponsSelector(show2hWeaponRef.value!, player.sim);
		}

		// makePhaseSelector(this.tabContent.getElementsByClassName('selector-modal-phase-selector')[0] as HTMLElement, player.sim);

		if (this.label !== SelectorModalTabs.Runes) {
			makeShowEPValuesSelector(showEpValuesRef.value!, player.sim);
		}

		if (label === SelectorModalTabs.Items) {
			const filtersMenu = new FiltersMenu(parent, player, currentSlot);
			filtersButtonRef.value?.addEventListener('click', () => filtersMenu.open());
		}

		this.listElem = this.tabContent.getElementsByClassName('selector-modal-list')[0] as HTMLElement;

		this.itemsToDisplay = [];

		this.scroller = new Clusterize(
			{
				getNumberOfRows: () => {
					return this.itemsToDisplay.length;
				},
				generateRows: (startIdx, endIdx) => {
					const items = [];
					for (let i = startIdx; i < endIdx; ++i) {
						if (i >= this.itemsToDisplay.length) break;
						items.push(this.createItemElem({ idx: this.itemsToDisplay[i], data: this.itemData[this.itemsToDisplay[i]] }));
					}
					return items;
				},
			},
			{
				rows: [],
				scroll_elem: this.listElem,
				content_elem: this.listElem,
				item_height: 56,
				show_no_data_row: false,
				no_data_text: '',
				tag: 'li',
				rows_in_block: 16,
				blocks_in_cluster: 2,
			},
		);

		const removeButton = this.tabContent.getElementsByClassName('selector-modal-remove-button')[0] as HTMLButtonElement;
		removeButton.addEventListener('click', _ => onRemove(TypedEvent.nextEventID()));

		if (label.startsWith('Enchants')) {
			removeButton.textContent = 'Remove Enchant';
		} else if (label.startsWith('Rune')) {
			removeButton.textContent = 'Remove Rune';
		}

		this.updateSelected();

		this.searchInput = this.tabContent.getElementsByClassName('selector-modal-search')[0] as HTMLInputElement;
		this.searchInput.addEventListener('input', () => this.applyFilters());
	}

	public sizeRefresh() {
		this.scroller.refresh(true);
		this.applyFilters();
	}

	public dispose() {
		this.scroller.dispose();
	}

	private getItemIdByItemType(item: ItemListType | null | undefined) {
		if (!item) return null;
		switch (this.label) {
			case SelectorModalTabs.Enchants:
				return (item as UIEnchant).effectId;
			case SelectorModalTabs.Items:
			case SelectorModalTabs.RandomSuffixes:
			case SelectorModalTabs.Runes:
				return (item as UIItem | ItemRandomSuffix).id;
			default:
				return null;
		}
	}

	public updateSelected() {
		const newEquippedItem = this.gearData.getEquippedItem();
		const newItem = this.equippedToItemFn(newEquippedItem);
		const newItemId = this.getItemIdByItemType(newItem);
		const newEP = newItem ? this.computeEP(newItem) : 0;

		this.scroller.elementUpdate(item => {
			const idx = (item as HTMLElement).dataset.idx!;
			const itemData = this.itemData[parseFloat(idx)];

			if (itemData.id === newItemId) item.classList.add('active');
			else item.classList.remove('active');

			const epDeltaElem = item.querySelector<HTMLSpanElement>('.selector-modal-list-item-ep-delta');
			if (epDeltaElem) {
				epDeltaElem.textContent = '';
				if (itemData.item) {
					const listItemEP = this.computeEP(itemData.item);
					if (newEP !== listItemEP) {
						formatDeltaTextElem(epDeltaElem, newEP, listItemEP, 0);
					}
				}
			}
		});
	}

	public applyFilters() {
		this.currentFilters = this.player.sim.getFilters();
		let itemIdxs = new Array<number>(this.itemData.length);
		for (let i = 0; i < this.itemData.length; ++i) {
			itemIdxs[i] = i;
		}

		const currentEquippedItem = this.player.getEquippedItem(this.slot);

		if (this.label == 'Items') {
			itemIdxs = this.player.filterItemData(itemIdxs, i => this.itemData[i].item as unknown as UIItem, this.slot);
		} else if (this.label == 'Enchants') {
			itemIdxs = this.player.filterEnchantData(itemIdxs, i => this.itemData[i].item as unknown as UIEnchant, this.slot, currentEquippedItem);
		}

		itemIdxs = itemIdxs.filter(i => {
			const listItemData = this.itemData[i];

			// TODO: We can bring this back at level 60 but for now this isn't working correctly because a lot of gear is incorrectly labeled
			// if (listItemData.phase > this.player.sim.getPhase()) {
			// 	return false;
			// }

			if (this.searchInput.value.length > 0) {
				const searchQuery = this.searchInput.value
					.toLowerCase()
					.replaceAll(/[^a-zA-Z0-9\s]/g, '')
					.split(' ');
				const name = listItemData.name.toLowerCase().replaceAll(/[^a-zA-Z0-9\s]/g, '');

				let include = true;
				searchQuery.forEach(v => {
					if (!name.includes(v)) include = false;
				});
				if (!include) {
					return false;
				}
			}

			return true;
		});

		let sortFn: (itemA: T, itemB: T) => number;
		if (this.slot == ItemSlot.ItemSlotTrinket1 || this.slot == ItemSlot.ItemSlotTrinket2) {
			// Trinket EP is weird so just sort by ilvl instead.
			sortFn = (itemA, itemB) => (itemB as unknown as UIItem).ilvl - (itemA as unknown as UIItem).ilvl;
		} else {
			sortFn = (itemA, itemB) => {
				const diff = this.computeEP(itemB) - this.computeEP(itemA);
				// if EP is same, sort by ilvl
				if (Math.abs(diff) < 0.01) {
					if ((itemB as unknown as UIItem).ilvl && (itemA as unknown as UIItem).ilvl) {
						return (itemB as unknown as UIItem).ilvl - (itemA as unknown as UIItem).ilvl;
					} else {
						return (itemB as unknown as UIItem).name < (itemA as unknown as UIItem).name ? 1 : -1;
					}
				}
				return diff;
			};
		}

		itemIdxs = itemIdxs.sort((dataA, dataB) => {
			const itemA = this.itemData[dataA];
			const itemB = this.itemData[dataB];
			if (this.isItemFavorited(itemA) && !this.isItemFavorited(itemB)) return -1;
			if (this.isItemFavorited(itemB) && !this.isItemFavorited(itemA)) return 1;

			return sortFn(itemA.item, itemB.item);
		});

		this.itemsToDisplay = itemIdxs;
		this.scroller.update();

		this.hideOrShowEPValues();
	}

	public sort(sortBy: ItemListSortBy) {
		if (this.sortBy === sortBy) {
			this.sortDirection = 1 - this.sortDirection;
		} else {
			this.sortDirection = SortDirection.DESC;
		}
		this.sortBy = sortBy;
		this.itemsToDisplay = this.sortIdxs(this.itemsToDisplay);
		this.scroller.update();
	}

	private sortIdxs(itemIdxs: Array<number>): number[] {
		let sortFn = (itemA: T, itemB: T) => {
			const first = this.sortDirection === SortDirection.DESC ? itemB : itemA;
			const second = this.sortDirection === SortDirection.DESC ? itemA : itemB;
			const diff = this.computeEP(first) - this.computeEP(second);
			// if EP is same, sort by ilvl
			if (Math.abs(diff) < 0.01) return (first as unknown as UIItem).ilvl - (second as unknown as UIItem).ilvl;
			return diff;
		};
		switch (this.sortBy) {
			case ItemListSortBy.ILVL:
				sortFn = (itemA: T, itemB: T) => {
					const first = this.sortDirection === SortDirection.DESC ? itemB : itemA;
					const second = this.sortDirection === SortDirection.DESC ? itemA : itemB;
					return (first as unknown as UIItem).ilvl - (second as unknown as UIItem).ilvl;
				};
				break;
		}

		return itemIdxs.sort((dataA, dataB) => {
			const itemA = this.itemData[dataA];
			const itemB = this.itemData[dataB];
			if (this.isItemFavorited(itemA) && !this.isItemFavorited(itemB)) return -1;
			if (this.isItemFavorited(itemB) && !this.isItemFavorited(itemA)) return 1;

			return sortFn(itemA.item, itemB.item);
		});
	}

	public hideOrShowEPValues() {
		const labels = this.tabContent.getElementsByClassName('ep-label');
		const container = this.tabContent.getElementsByClassName('selector-modal-list');
		const show = this.label != SelectorModalTabs.Runes && this.player.sim.getShowEPValues();
		const display = show ? '' : 'none';

		for (const label of labels) {
			(label as HTMLElement).style.display = display;
		}

		for (const c of container) {
			if (show) c.classList.remove('hide-ep');
			else c.classList.add('hide-ep');
		}
	}

	private createItemElem(item: ItemDataWithIdx<T>): JSX.Element {
		const itemData = item.data;
		const itemEP = this.computeEP(itemData.item);

		const equippedItem = this.equippedToItemFn(this.gearData.getEquippedItem());
		const equippedItemID = this.getItemIdByItemType(equippedItem);
		const equippedItemEP = equippedItem ? this.computeEP(equippedItem) : 0;

		const nameElem = ref<HTMLLabelElement>();
		const anchorElem = ref<HTMLAnchorElement>();
		const iconElem = ref<HTMLImageElement>();
		const favoriteElem = ref<HTMLButtonElement>();
		const favoriteIconElem = ref<HTMLElement>();
		const compareContainer = ref<HTMLDivElement>();
		const compareButton = ref<HTMLButtonElement>();

		const listItemElem = (
			<li className={clsx('selector-modal-list-item', equippedItemID === itemData.id && 'active')} dataset={{ idx: item.idx.toString() }}>
				<div className="selector-modal-list-label-cell">
					<a className="selector-modal-list-item-link" ref={anchorElem} dataset={{ whtticon: 'false' }}>
						<img className="selector-modal-list-item-icon" ref={iconElem}></img>
						<label className="selector-modal-list-item-name" ref={nameElem}>
							{itemData.name}
						</label>
					</a>
				</div>
				{this.label === SelectorModalTabs.Items && (
					<>
						<div className="selector-modal-list-item-source-container">
							{this.getSourceInfo(itemData.item as unknown as UIItem, this.player.sim)}
						</div>
						<div className="selector-modal-list-item-ilvl-container">{(itemData.item as unknown as UIItem).ilvl}</div>
					</>
				)}
				{![ItemSlot.ItemSlotTrinket1, ItemSlot.ItemSlotTrinket2].includes(this.slot) && (
					<div className="selector-modal-list-item-ep">
						<span className="selector-modal-list-item-ep-value">
							{itemEP < 9.95 ? itemEP.toFixed(1).toString() : Math.round(itemEP).toString()}
						</span>
						<span
							className="selector-modal-list-item-ep-delta"
							ref={e => itemData.item && equippedItemEP !== itemEP && formatDeltaTextElem(e, equippedItemEP, itemEP, 0)}
						/>
					</div>
				)}
				<div className="selector-modal-list-item-favorite-container">
					<button className="selector-modal-list-item-favorite btn btn-link p-0" ref={favoriteElem}>
						<i ref={favoriteIconElem} className="far fa-star fa-xl" />
					</button>
				</div>
				<div ref={compareContainer} className="selector-modal-list-item-compare-container hide">
					<button className="selector-modal-list-item-compare btn btn-link p-0" ref={compareButton}>
						<i className="fas fa-arrow-right-arrow-left fa-xl" />
					</button>
				</div>
			</li>
		);

		const toggleFavorite = (isFavorite: boolean) => {
			const filters = this.player.sim.getFilters();

			let favMethodName: keyof DatabaseFilters;
			let favId;
			switch (this.label) {
				case SelectorModalTabs.Items:
					favMethodName = 'favoriteItems';
					favId = itemData.id;
					break;
				case SelectorModalTabs.Enchants:
					favMethodName = 'favoriteEnchants';
					favId = getUniqueEnchantString(itemData.item as unknown as UIEnchant);
					break;
				case SelectorModalTabs.Runes:
					favMethodName = 'favoriteRunes';
					favId = itemData.id;
					break;
				case SelectorModalTabs.RandomSuffixes:
					favMethodName = 'favoriteRandomSuffixes';
					favId = itemData.id;
					break;
				default:
					return;
			}

			if (isFavorite) {
				filters[favMethodName].push(favId as never);
			} else {
				const favIdx = filters[favMethodName].indexOf(favId as never);
				if (favIdx !== -1) {
					filters[favMethodName].splice(favIdx, 1);
				}
			}

			favoriteElem.value!.classList.toggle('text-brand');
			favoriteIconElem.value!.classList.toggle('fas');
			favoriteIconElem.value!.classList.toggle('far');
			listItemElem.dataset.fav = isFavorite.toString();
			this.player.sim.setFilters(TypedEvent.nextEventID(), filters);
		};
		favoriteElem.value!.addEventListener('click', () => toggleFavorite(listItemElem.dataset.fav === 'false'));

		const isFavorite = this.isItemFavorited(itemData);
		if (isFavorite) {
			favoriteElem.value!.classList.add('text-brand');
			favoriteIconElem.value?.classList.add('fas');
			listItemElem.dataset.fav = 'true';
		} else {
			favoriteIconElem.value?.classList.add('far');
			listItemElem.dataset.fav = 'false';
		}

		const favoriteTooltip = tippy(favoriteElem.value!);
		const toggleFavoriteTooltipContent = (isFavorited: boolean) => favoriteTooltip.setContent(isFavorited ? 'Remove from favorites' : 'Add to favorites');
		toggleFavoriteTooltipContent(listItemElem.dataset.fav === 'true');

		if (this.label === SelectorModalTabs.Items) {
			const batchSimTooltip = tippy(compareButton.value!);

			this.bindToggleCompare(compareContainer.value!);
			const simUI = this.simUI instanceof IndividualSimUI ? this.simUI : null;
			if (simUI) {
				const checkHasItem = () => simUI.bt.hasItem(ItemSpec.create({ id: itemData.id }));
				const toggleCompareButtonState = () => {
					const hasItem = checkHasItem();
					batchSimTooltip.setContent(hasItem ? 'Remove from Batch sim' : 'Add to Batch sim');
					compareButton.value!.classList[hasItem ? 'add' : 'remove']('text-brand');
				};

				toggleCompareButtonState();
				simUI.bt.itemsChangedEmitter.on(() => {
					toggleCompareButtonState();
				});

				compareButton.value!.addEventListener('click', () => {
					const hasItem = checkHasItem();
					simUI.bt[hasItem ? 'removeItem' : 'addItem'](ItemSpec.create({ id: itemData.id }));

					new Toast({
						delay: 1000,
						variant: 'success',
						body: (
							<>
								<strong>{itemData.name}</strong> was {hasItem ? <>removed from the batch</> : <>added to the batch</>}.
							</>
						),
					});
					// TODO: should we open the bulk sim UI or should we run in the background showing progress, and then sort the items in the picker?
				});
			}
		}

		anchorElem.value!.addEventListener('click', (event: Event) => {
			event.preventDefault();
			if (event.target === favoriteElem.value) return false;
			this.onItemClick(itemData);
		});

		itemData.actionId.fill().then(filledId => {
			filledId.setWowheadHref(anchorElem.value!);
			iconElem.value!.src = filledId.iconUrl;
		});

		setItemQualityCssClass(nameElem.value!, itemData.quality);

		return listItemElem;
	}

	private isItemFavorited(itemData: ItemData<T>): boolean {
		if (this.label === SelectorModalTabs.Items) {
			return this.currentFilters.favoriteItems.includes(itemData.id);
		} else if (this.label === SelectorModalTabs.Enchants) {
			return this.currentFilters.favoriteEnchants.includes(getUniqueEnchantString(itemData.item as unknown as UIEnchant));
		} else if (this.label === SelectorModalTabs.Runes) {
			return this.currentFilters.favoriteRunes.includes(itemData.id);
		} else if (this.label === SelectorModalTabs.RandomSuffixes) {
			return this.currentFilters.favoriteRandomSuffixes.includes(itemData.id);
		}
		return false;
	}

	private getSourceInfo(item: UIItem, sim: Sim): JSX.Element {
		const makeAnchor = (href: string, inner: string | JSX.Element) => {
			return (
				<a href={href} target="_blank" dataset={{ whtticon: 'false' }}>
					<small>{inner}</small>
				</a>
			);
		};

		if (!item.sources || item.sources.length == 0) {
			if (item.randomSuffixOptions.length) {
				return makeAnchor(`${ActionId.makeItemUrl(item.id)}#dropped-by`, 'World Drop');
			}

			return <></>;
		}

		let source = item.sources[0];
		if (source.source.oneofKind == 'crafted') {
			const src = source.source.crafted;

			if (src.spellId) {
				return makeAnchor(ActionId.makeSpellUrl(src.spellId), professionNames.get(src.profession) ?? 'Unknown');
			}
			return makeAnchor(ActionId.makeItemUrl(item.id), professionNames.get(src.profession) ?? 'Unknown');
		} else if (source.source.oneofKind == 'drop') {
			const src = source.source.drop;
			const zone = sim.db.getZone(src.zoneId);
			const npc = sim.db.getNpc(src.npcId);
			if (!zone) {
				return makeAnchor(`${ActionId.makeItemUrl(item.id)}#dropped-by`, 'World Drop');
			}

			const category = src.category ? ` - ${src.category}` : '';
			if (npc) {
				return makeAnchor(
					ActionId.makeNpcUrl(npc.id),
					<span>
						{zone.name}
						<br />
						{npc.name + category}
					</span>,
				);
			} else if (src.otherName) {
				return makeAnchor(
					ActionId.makeZoneUrl(zone.id),
					<span>
						{zone.name}
						<br />
						{src.otherName}
					</span>,
				);
			}
			return makeAnchor(ActionId.makeZoneUrl(zone.id), zone.name);
		} else if (source.source.oneofKind == 'quest' && source.source.quest.name) {
			const src = source.source.quest;
			return makeAnchor(
				ActionId.makeQuestUrl(src.id),
				<>
					<span>Quest</span>
					<br />
					<span>
						{src.name}
						{item.factionRestriction == UIItem_FactionRestriction.ALLIANCE_ONLY && (
							<img src="/sod/assets/img/alliance.png" className="ms-1" width="15" height="15" />
						)}
						{item.factionRestriction == UIItem_FactionRestriction.HORDE_ONLY && (
							<img src="/sod/assets/img/horde.png" className="ms-1" width="15" height="15" />
						)}
					</span>
				</>,
			);
		} else if ((source = item.sources.find(source => source.source.oneofKind == 'rep') ?? source).source.oneofKind == 'rep') {
			const factionNames = item.sources
				.map(src => (src.source.oneofKind == 'rep' ? sim.db.getFaction(src.source.rep.repFactionId)?.name : ''))
				.filter(src => src != '');
			// We assume that if an item is available from multiple reputations, it's available at the same rep level from each.
			// The main case for multi-faction items are shared PVP items where this is always true, so it's not a big deal right now.
			const src = source.source.rep;
			return makeAnchor(
				ActionId.makeItemUrl(item.id),
				<>
					{factionNames.map(name => (
						<span>
							{name}
							{item.factionRestriction == UIItem_FactionRestriction.ALLIANCE_ONLY && (
								<img src="/sod/assets/img/alliance.png" className="ms-1" width="15" height="15" />
							)}
							{item.factionRestriction == UIItem_FactionRestriction.HORDE_ONLY && (
								<img src="/sod/assets/img/horde.png" className="ms-1" width="15" height="15" />
							)}
							<br />
						</span>
					))}
					<span>{REP_LEVEL_NAMES[src.repLevel]}</span>
				</>,
			);
		} else if (source.source.oneofKind == 'soldBy') {
			const src = source.source.soldBy;
			return makeAnchor(
				ActionId.makeNpcUrl(src.npcId),
				<span>
					Sold by
					<br />
					{src.npcName}
				</span>,
			);
		}
		return <></>;
	}

	private bindToggleCompare(element: Element) {
		const toggleCompare = () => element.classList[!this.player.sim.getShowExperimental() ? 'add' : 'remove']('hide');
		toggleCompare();
		this.player.sim.showExperimentalChangeEmitter.on(() => {
			toggleCompare();
		});
	}
}
