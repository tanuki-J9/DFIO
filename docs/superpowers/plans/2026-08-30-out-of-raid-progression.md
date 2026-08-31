# Out-of-Raid Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add commander levels and a seven-facility base with atomic material upgrades, specified duplicate-red costs, permanent facility effects, automatic medical items, mobility upgrades, and backward-compatible migration.

**Architecture:** Put immutable tuning in `js/config/base.js`, commander XP in `js/systems/commander.js`, and all facility transactions/effect aggregation in `js/systems/base.js`. Persist commander progress and facility levels centrally; snapshot action-affecting bonuses at launch so upgrading during or after an action cannot change that run. UI consumes view models and never deducts resources directly.

**Tech Stack:** Browser-native ES modules, HTML/CSS, Node.js built-in test runner, no external dependencies.

**Spec:** `docs/superpowers/specs/2026-08-30-out-of-raid-progression-design.md`

## Global Constraints

- Commander level is 1–30; facilities are 1–10.
- Base bonuses never count toward readiness; access remains `branch.readiness × active squad size`.
- Other facilities cannot exceed Command Center level; Command Center uses commander gates `1,3,6,9,12,15,18,21,25,30`.
- Each upgrade consumes at most 10 item units and is atomic.
- Levels 9–10 require the exact facility-specific duplicate reds in the spec; the first copy is protected.
- Healing never triggers on kill; medical bonus caps at 50%.
- Total march-speed bonus caps at 50% and never changes combat, scavenging, or extraction speed.
- Existing inventory, gallery, operators, skills, stats, and active runs survive migration.

## File Map

- Create `js/config/base.js`: facility metadata, costs, pools, XP curve and effect constants.
- Create `js/systems/commander.js`: XP ledger, level calculation and settlement.
- Create `js/systems/base.js`: upgrade validation/commit, red protection, facility effect aggregation.
- Create `js/ui/prepare/basePanel.js`: base overview and facility detail UI.
- Create `tests/commanderProgression.test.mjs`, `tests/baseUpgrade.test.mjs`, `tests/baseEffects.test.mjs`, `tests/basePanel.test.mjs`.
- Modify `js/core/state.js`, `js/main.js`, existing config/systems/UI integration points and CSS listed per task.

---

### Task 1: Progression Configuration

**Files:**
- Create: `js/config/base.js`
- Modify: `js/config/index.js`
- Test: `tests/commanderProgression.test.mjs`
- Test: `tests/baseUpgrade.test.mjs`

**Interfaces:**
- Produces `FACILITY`, `FACILITY_ORDER`, `FACILITY_META`, `COMMANDER_XP_PER_LEVEL`, `COMMAND_CENTER_GATES`, `FACILITY_COSTS`, `facilityCost(id,targetLevel)`, `commanderLevelForXp(totalXp)`.

- [ ] Write failing tests asserting seven facilities, 29 exact XP requirements, ten cost rows per facility, item totals ≤10, and exact level-9/10 red IDs.

```js
test('all facility costs obey material cap', () => {
  FACILITY_ORDER.forEach((id) => {
    for (let level = 2; level <= 10; level += 1) {
      const cost = facilityCost(id, level);
      assert.ok(cost.hafCoin > 0);
      assert.ok(cost.items.reduce((n, row) => n + row.count, 0) <= 10);
    }
  });
});
```

- [ ] Run `node --test tests/commanderProgression.test.mjs tests/baseUpgrade.test.mjs`; expect missing-module/export failures.
- [ ] Implement exact configuration from the spec. The 29-entry XP array contains four `500` entries for target levels 2–5, then five entries each of `1200`, `2500`, `5000`, `9000`, and `15000` for target levels 6–30. Flexible gold rows use `{kind:'pool',ids:string[],count:number}`; reds use `{kind:'collectible',id,count,protectFirst:true}`.
- [ ] Implement XP calculation:

```js
export function commanderLevelForXp(totalXp) {
  let rest = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 1;
  while (level < 30 && rest >= COMMANDER_XP_PER_LEVEL[level - 1]) {
    rest -= COMMANDER_XP_PER_LEVEL[level - 1];
    level += 1;
  }
  return level;
}
```

- [ ] Re-run focused tests; expect PASS.
- [ ] Commit with `git add js/config/base.js js/config/index.js tests/commanderProgression.test.mjs tests/baseUpgrade.test.mjs && git commit -m "feat: define commander and facility progression"`.

---

### Task 2: State Schema and Migration

**Files:**
- Modify: `js/core/state.js`
- Test: `tests/commanderProgression.test.mjs`

**Interfaces:**
- Produces `commander:{level,totalXp,currentXp}`, `base.facilities:Record<string,number>`, run fields `commanderXp`, `baseBonuses`, `medical`, `mobility`.

- [ ] Add failing tests for fresh state, old saves without base fields, capped corrupt values, and active legacy runs.

```js
test('old save gets neutral base without losing data', () => {
  const old = createInitialState();
  delete old.commander; delete old.base;
  const next = sanitizeState(old);
  assert.equal(next.commander.level, 1);
  assert.deepEqual(Object.values(next.base.facilities), Array(7).fill(1));
  assert.deepEqual(next.inventory, old.inventory);
});
```

- [ ] Run the migration test; expect `commander`/`base` undefined.
- [ ] Add schema defaults and focused sanitizers. Derive level from total XP; clamp facilities 1–10; give old active runs neutral snapshots instead of rejecting them.
- [ ] Run `node --test tests/commanderProgression.test.mjs tests/gearProgression.test.mjs`; expect PASS.
- [ ] Commit `feat: migrate saves for base progression`.

---

### Task 3: Commander XP Ledger

**Files:**
- Create: `js/systems/commander.js`
- Modify: `js/systems/march.js`, `js/systems/loot.js`, `js/systems/settlement.js`, `js/ui/settlement.js`
- Test: `tests/commanderProgression.test.mjs`

**Interfaces:**
- Produces `addRunXp(kind,amount,s)`, `previewSettlementXp(success,s)`, `settleCommanderXp(success,s)` returning `{earned,applied,beforeLevel,afterLevel,totalXp}`.

- [ ] Write failing tests for exact difficulty XP, kill/loot XP, 30% failure floor, level cap and settlement idempotency.
- [ ] Run test; expect missing commander-system exports.
- [ ] Implement `run.commanderXp` plus `run.commanderXpSettled`. Award kill XP only in the confirmed kill path and gold/red XP only when loot is first accepted into carry.
- [ ] Call settlement before clearing `s.run`; attach result to `lastSettlement`; show earned XP and level-up progress.
- [ ] Run `node --test tests/commanderProgression.test.mjs tests/marchLootReveal.test.mjs`; expect PASS.
- [ ] Commit `feat: award commander experience`.

---

### Task 4: Atomic Facility Upgrades and Red Protection

**Files:**
- Create: `js/systems/base.js`
- Modify: `js/systems/collection.js`
- Test: `tests/baseUpgrade.test.mjs`

**Interfaces:**
- Produces `protectedCollectibleCount(id,s)`, `consumableCollectibleCount(id,s)`, `facilityUpgradeView(id,s)`, `validateFacilityUpgrade(id,selections,s)`, `upgradeFacility(id,selections,s)`.
- `selections` is `{poolPicks:Array<{tplId:string,count:number}>}`.

- [ ] Write failing tests for Command Center gates, facility cap, wrong red, first-copy protection, flexible-pool totals, insufficient currency/materials and atomic rollback.

```js
test('only duplicate red is consumable', () => {
  const s = stateWithCollectible('c_gpu', 2);
  assert.equal(protectedCollectibleCount('c_gpu', s), 1);
  assert.equal(consumableCollectibleCount('c_gpu', s), 1);
});
```

- [ ] Run tests; expect missing base-system exports.
- [ ] Implement pure validation that returns a normalized debit plan without mutation. Only after every check passes may `upgradeFacility` debit currency/materials/collectibles and increment level, followed by one notification.
- [ ] Re-run tests; assert failed upgrades leave a deep-cloned state unchanged.
- [ ] Commit `feat: add atomic base upgrades and red protection`.

---

### Task 5: Base UI

**Files:**
- Create: `js/ui/prepare/basePanel.js`
- Modify: `js/ui/prepare/index.js`, `js/ui/prepare/mapPanel.js`, `js/ui/prepare/galleryPanel.js`, `js/ui/prepare/warehousePanel.js`, `js/ui/topbar.js`, `css/style.css`
- Test: `tests/basePanel.test.mjs`

**Interfaces:**
- Produces `renderBasePanel()`, `renderFacilityDetail(id)`, `handleFacilityUpgrade(id,selections)`, red-confirmation flow.

- [ ] Write failing tests that render commander XP, seven facility cards, level routes, missing-resource states, source maps, protected-red locks and explicit permanent-consumption confirmation.
- [ ] Run UI tests; expect missing module.
- [ ] Add `base` to Special Operations navigation. Render facility cards and detail view using `facilityUpgradeView`; UI never directly mutates resources.
- [ ] Mark first red copies in gallery/warehouse. Require a second confirmation callback for level 9–10.
- [ ] Run `node --test tests/basePanel.test.mjs tests/itemArt.integration.test.mjs`; expect PASS.
- [ ] Commit `feat: add special operations base interface`.

---

### Task 6: Armory and Armor Effects

**Files:**
- Modify: `js/systems/base.js`, `js/systems/equipment.js`, `js/ui/prepare/equipmentPanel.js`
- Test: `tests/baseEffects.test.mjs`

**Interfaces:**
- `baseBonuses(s)` adds `weaponDiscount`, `armorDiscount`, `maxWeaponLevel`, `maxArmorLevel`.
- Produces `effectiveShopPrice(tpl,s)`.

- [ ] Write failing tests: facility 6 unlocks level-5 stock; 12% discount is rounded consistently; direct purchase rejects locked level-6 gear.
- [ ] Run tests; expect missing bonus behavior.
- [ ] Implement unlock mapping `1/2/4/6/9 → 2/3/4/5/6` and 2% discount per facility level capped at 20%. Keep locked cards visible with requirements.
- [ ] Re-check unlock and effective price inside purchase system, not only UI. Never mutate template `value` or readiness.
- [ ] Run base effects, item-art and gear-progression tests; expect PASS.
- [ ] Commit `feat: apply base shop unlocks and discounts`.

---

### Task 7: Storage and Safebox

**Files:**
- Modify: `js/systems/base.js`, `js/systems/equipment.js`, `js/systems/settlement.js`, `js/systems/safebox.js`, `js/ui/prepare/warehousePanel.js`, `js/ui/settlement.js`
- Test: `tests/baseEffects.test.mjs`

**Interfaces:**
- Produces `warehouseCapacity(s)`, `warehouseUsed(s)`, `warehouseFree(s)` and bonus `safeboxSlots`.

- [ ] Write failing tests for +10 slots/level, safebox milestones 3/6/9, batch-sell/auto-sort gates, and extraction overflow preservation.
- [ ] Run tests; expect capacity functions missing.
- [ ] Define slot accounting for equipment instances and stack types. When extraction overflows, keep pending items in settlement and require sell/discard resolution; never truncate or silently delete.
- [ ] Add batch sell at level 5 and stable category/rarity/value sort at level 8.
- [ ] Run base effects and loot-reveal tests; expect PASS.
- [ ] Commit `feat: add base storage capacity and tools`.

---

### Task 8: Intelligence Effects

**Files:**
- Modify: `js/systems/base.js`, `js/systems/operator.js`, `js/systems/nodePlan.js`, `js/systems/loot.js`, `js/main.js`, `js/ui/explore/panel.js`
- Test: `tests/baseEffects.test.mjs`

**Interfaces:**
- `baseBonuses(s)` adds `scavengeSpeed`, `crateTier`, `previewNodes`, `markBoss`, `redWeightBonus`; launch copies them to `run.baseBonuses`.

- [ ] Write failing tests for 3% scavenge and 2% high-crate weight per level, preview milestones, boss marking, launch snapshot stability and non-guaranteed red weighting.
- [ ] Run tests; expect neutral/missing fields.
- [ ] Merge facility values with existing skill/operator bonuses under existing caps. Preview queue entries without consuming/reordering them. Increase red weight while retaining gold candidates.
- [ ] Render one/two future nodes and boss marker.
- [ ] Run base effects, stage and loot-reveal tests; expect PASS.
- [ ] Commit `feat: apply intelligence facility effects`.

---

### Task 9: Medical Tactical Items

**Files:**
- Modify: `js/config/equipment.js`, `js/config/skills.js`, `js/systems/base.js`, `js/systems/skill.js`, `js/systems/march.js`, `js/systems/operatorSkills.js`, `js/main.js`, `js/ui/explore/stage.js`, `css/stage.css`
- Test: `tests/baseEffects.test.mjs`

**Interfaces:**
- Healing template field `healing:{triggerRatio:0.5,healRatio:0.18,baseUses:1}`.
- Run snapshot `medical:{maxUses,remainingUses,healRatio}`.
- Produces `tryAutoMedical(run,now)` returning `{used,targetId,amount}` or `{used:false}`.

- [ ] Write failing tests for below-50% trigger, lowest-ratio living target, 3/6/9 use milestones, max 50% bonus, no item/no trigger, one use per tick, and no kill healing.
- [ ] Run tests; expect missing healing behavior and legacy `regenPct` still present.
- [ ] Rename `sk_regen` to `战术救护` without changing ID/level; change effect to `medicalHealPct` at 3% per level. Aggregate with facility 5% per level and cap total at 50%.
- [ ] Snapshot equipped healing tactical item at launch. After combat damage sync, auto-use once on the lowest living member below 50%. Remove kill-regeneration block; Butterfly skills remain independent.
- [ ] Render heal FX and remaining uses. Run base/stage tests; expect PASS.
- [ ] Commit `feat: add automatic medical tactical healing`.

---

### Task 10: Mobility Facility

**Files:**
- Modify: `js/systems/base.js`, `js/systems/march.js`, `js/systems/nodePlan.js`, `js/main.js`, `js/ui/explore/panel.js`
- Test: `tests/baseEffects.test.mjs`

**Interfaces:**
- `baseBonuses(s)` adds `marchSpeed`, `minNodeGap`, `startPreviewNodes`, `skipNormalEnemies`.
- Run snapshot `mobility:{remainingSkips,startPreviewNodes}`.
- Produces `shouldSkipNormalEnemy(run,enemyClass)`.

- [ ] Write failing tests for +2.5%/level, total 50% cap, level-3 0.5s floor, level-6 preview, and exactly one/two normal skips at level 9/10.
- [ ] Run tests; expect missing mobility behavior.
- [ ] Apply bonus only in march gap calculation. Consume a skip after selecting a normal encounter but before combat creation; log quick pass and award no kill, loot, XP or skill triggers. Never skip elite/operator/boss.
- [ ] Run base effects and march tests; expect PASS.
- [ ] Commit `feat: add mobility facility march effects`.

---

### Task 11: Merge Existing Skills into Facilities

**Files:**
- Modify: `js/config/skills.js`, `js/systems/skill.js`, `js/ui/prepare/basePanel.js`, `js/ui/prepare/index.js`
- Delete: `js/ui/prepare/skillPanel.js`
- Test: `tests/basePanel.test.mjs`, `tests/baseEffects.test.mjs`

**Interfaces:**
- Produces `skillNodesForFacility(facilityId,s)` while preserving `upgradeSkill(nodeId,s)` and all saved skill IDs.

- [ ] Write failing test that every existing skill ID appears in exactly one facility and the standalone skill tab no longer exists.
- [ ] Run tests; expect old branch-only grouping/tab.
- [ ] Add facility mapping: combat→Armory, defense→Armor, HP/medical→Medical, scavenging→Intel, extract/safebox→Storage. Render existing upgrade cards inside facility detail.
- [ ] Remove old tab/import/handler only after every skill is reachable. Preserve levels and costs.
- [ ] Run full tests; expect PASS.
- [ ] Commit `feat: merge permanent skills into base facilities`.

---

### Task 12: Full Verification and Delivery

**Files:**
- Modify only for defects reproduced by new failing tests.

- [ ] Run fresh automated verification:

```bash
node --test tests/*.test.mjs
for f in $(rg --files js -g '*.js'); do node --check "$f" || exit 1; done
git diff --check
```

- [ ] Verify fixtures for fresh state, old save, active legacy run, maxed old skills, one protected red, duplicate red, full warehouse and max facilities.
- [ ] Serve with `python -m http.server 8000`; inspect desktop/mobile base overview, costs, red confirmation, locked shops, XP settlement, overflow resolution, medical FX and mobility logs.
- [ ] Match every spec acceptance criterion to a passing test or observed UI result. Any defect gets a failing regression test before a fix.
- [ ] Request independent review with base/head commits, spec, plan and full test command; fix all Critical/Important findings.
- [ ] Re-run the complete verification command.
- [ ] Commit verified fixes, then create and test a full archive:

```bash
git archive --format=zip --prefix=DFIO/ -o DFIO_out_of_raid_progression.zip HEAD
unzip -t DFIO_out_of_raid_progression.zip
```
