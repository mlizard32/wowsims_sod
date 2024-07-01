package rogue

import (
	"time"

	"github.com/wowsims/sod/sim/core"
	"github.com/wowsims/sod/sim/core/proto"
	"github.com/wowsims/sod/sim/core/stats"
)

func (rogue *Rogue) makeCrimsonTempestHitSpell() *core.Spell {
	actionID := core.ActionID{SpellID: 412096}
	procMask := core.ProcMaskMeleeMHSpecial

	return rogue.RegisterSpell(core.SpellConfig{
		ActionID:    actionID,
		SpellSchool: core.SpellSchoolPhysical,
		DefenseType: core.DefenseTypeMelee,
		ProcMask:    procMask,
		Flags:       core.SpellFlagMeleeMetrics,

		DamageMultiplier: []float64{1, 1.1, 1.2, 1.3}[rogue.Talents.SerratedBlades],
		ThreatMultiplier: 1,

		Dot: core.DotConfig{
			Aura: core.Aura{
				Label: "Crimson Tempest",
				Tag:   RogueBleedTag,
			},
			NumberOfTicks: 1 + rogue.ComboPoints(),
			TickLength:    time.Second * 2,

			OnSnapshot: func(sim *core.Simulation, target *core.Unit, dot *core.Dot, isRollover bool) {
				dot.Snapshot(target, rogue.CrimsonTempestDamage(rogue.ComboPoints()), isRollover)
			},
			OnTick: func(sim *core.Simulation, target *core.Unit, dot *core.Dot) {
				dot.CalcAndDealPeriodicSnapshotDamage(sim, target, dot.OutcomeTick)
			},
		},

		ApplyEffects: func(sim *core.Simulation, target *core.Unit, spell *core.Spell) {
			result := spell.CalcOutcome(sim, target, spell.OutcomeMeleeSpecialHit)
			if result.Landed() {
				dot := spell.Dot(target)
				dot.Spell = spell
				dot.NumberOfTicks = rogue.ComboPoints() + 1
				dot.Apply(sim)
			}
		},
	})
}

func (rogue *Rogue) registerCrimsonTempestSpell() {
	if !rogue.HasRune(proto.RogueRune_RuneCrimsonTempest) {
		return
	}

	// Must be updated to match combo points spent
	// TODO: array of combo values
	hitSpell := rogue.makeCrimsonTempestHitSpell()

	rogue.CrimsonTempest = rogue.RegisterSpell(core.SpellConfig{
		ActionID:     core.ActionID{SpellID: 412096},
		SpellSchool:  core.SpellSchoolPhysical,
		DefenseType:  core.DefenseTypeMelee,
		ProcMask:     core.ProcMaskMeleeMHSpecial, // No multiple Relentless procs
		Flags:        rogue.finisherFlags(),
		MetricSplits: 6,

		EnergyCost: core.EnergyCostOptions{
			Cost:   35,
			Refund: 0,
		},
		Cast: core.CastConfig{
			DefaultCast: core.Cast{
				GCD: time.Second,
			},
			IgnoreHaste: true,
		},

		ApplyEffects: func(sim *core.Simulation, target *core.Unit, spell *core.Spell) {
			rogue.BreakStealth(sim)

			for i := range sim.Encounter.TargetUnits {
				hitSpell.Cast(sim, sim.Encounter.TargetUnits[i])
			}

			rogue.ApplyFinisher(sim, spell)
		},
	})
}

func (rogue *Rogue) CrimsonTempestDamage(comboPoints int32) float64 {
	return []float64{0.15, 0.3, 0.45, 0.6, 0.75, 0.9}[comboPoints] * rogue.GetStat(stats.AttackPower)
}
