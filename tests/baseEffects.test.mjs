import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIFFICULTY, ENEMY_CLASS, EQUIPMENT_TEMPLATES, FACILITY, RARITY, SKILL_NODES,
  getCollectible, getTemplate
} from '../js/config/index.js';
import {
  createInitialState, createRun, getState, sanitizeState, setState
} from '../js/core/state.js';
import { getReadiness } from '../js/systems/readiness.js';
import {
  renderEquipmentPanel,
  setEquipSubTab
} from '../js/ui/prepare/equipmentPanel.js';
import {
  renderWarehousePanel, setWarehouseCat
} from '../js/ui/prepare/warehousePanel.js';
import { renderSettlementBody } from '../js/ui/settlement.js';
import { baseBonuses } from '../js/systems/base.js';
import * as baseSystem from '../js/systems/base.js';
import { squadCombatStats } from '../js/systems/operator.js';
import { skillBonuses, upgradeSkill } from '../js/systems/skill.js';
import * as operatorSkills from '../js/systems/operatorSkills.js';
import { advance, shouldSkipNormalEnemy, startMarch } from '../js/systems/march.js';
import { previewIntelNodes } from '../js/systems/nodePlan.js';
import {
  cancelExtraction, extractDuration, tickExtraction
} from '../js/systems/extraction.js';
import {
  autoEquipBest,
  applyLoadoutPreset,
  autoSortWarehouse,
  batchSellWarehouseCategory,
  buyEquipment,
  buyMaterial,
  candidatesForSlot,
  discardLegacyAmmo,
  discardLegacyEquipment,
  effectiveShopPrice,
  equip,
  saveLoadoutPreset,
  shopEquipmentList,
  stableWarehouseSort,
  warehouseCapacity,
  warehouseFree,
  warehouseUsed
} from '../js/systems/equipment.js';
import {
  candidates as safeboxCandidates,
  capacity as safeboxCapacity,
  depositEquipment as depositSafeboxEquipment
} from '../js/systems/safebox.js';
import * as loot from '../js/systems/loot.js';
import { LOOT_KIND } from '../js/systems/loot.js';
import { renderHeader } from '../js/ui/explore/panel.js';
import {
  dismissSettlement, resolveSettlementOverflow, settle
} from '../js/systems/settlement.js';

function stateWithFacilities({ armory = 1, armor = 1, storage = 1 } = {}) {
  const s = createInitialState();
  s.base.facilities[FACILITY.ARMORY] = armory;
  s.base.facilities[FACILITY.ARMOR] = armor;
  s.base.facilities[FACILITY.STORAGE] = storage;
  return s;
}

test('command center unlocks loadout preset slots at levels three six and nine plus eternal construction at ten', () => {
  const s = stateWithFacilities();

  assert.deepEqual(
    [1, 2, 3, 6, 9, 10].map((level) => {
      s.base.facilities[FACILITY.COMMAND_CENTER] = level;
      const bonuses = baseBonuses(s);
      return [level, bonuses.loadoutPresetSlots, bonuses.eternalConstruction];
    }),
    [
      [1, 0, false],
      [2, 0, false],
      [3, 1, false],
      [6, 2, false],
      [9, 3, false],
      [10, 3, true]
    ]
  );
});

test('loadout presets preserve current gear when saved references are missing and can restore legacy gear', () => {
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.COMMAND_CENTER] = 3;
  s.operators = {
    unlocked: ['op_weilong'],
    levels: { op_weilong: 1 },
    squad: ['op_weilong']
  };
  s.inventory = [
    { uid: 'saved-weapon', tplId: 'w_m4', slot: 'weapon' },
    { uid: 'current-weapon', tplId: 'w_ak', slot: 'weapon' },
    { uid: 'saved-armor', tplId: 'a_t2', slot: 'armor' },
    { uid: 'legacy-helmet', tplId: 'removed_legacy_helmet', slot: 'helmet' }
  ];
  s.loadouts = {
    op_weilong: {
      weapon: 'saved-weapon', armor: 'saved-armor', helmet: 'legacy-helmet',
      bag: null, tactical: null
    }
  };

  assert.deepEqual(saveLoadoutPreset(0, s), {
    ok: true, msg: '配装预设 1 已保存', slot: 0
  });
  assert.equal(saveLoadoutPreset(1, s).ok, false);

  s.inventory = s.inventory.filter((item) => item.uid !== 'saved-weapon');
  s.loadouts.op_weilong = {
    weapon: 'current-weapon', armor: null, helmet: null, bag: null, tactical: null
  };
  const inventoryBefore = structuredClone(s.inventory);

  assert.deepEqual(applyLoadoutPreset(0, s), {
    ok: true, msg: '配装预设 1 已应用，跳过 1 件缺失装备', slot: 0, skipped: 1
  });
  assert.deepEqual(s.loadouts.op_weilong, {
    weapon: 'current-weapon', armor: 'saved-armor', helmet: 'legacy-helmet',
    bag: null, tactical: null
  });
  assert.deepEqual(s.inventory, inventoryBefore);
});

test('loadout preset application cannot hide gear on an operator absent from the current save', () => {
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.COMMAND_CENTER] = 3;
  s.operators = {
    unlocked: ['op_weilong'], levels: { op_weilong: 1 }, squad: ['op_weilong']
  };
  s.inventory = [{ uid: 'only-weapon', tplId: 'w_ak', slot: 'weapon' }];
  s.loadouts = {
    op_weilong: { weapon: 'only-weapon', armor: null, helmet: null, bag: null, tactical: null }
  };
  s.base.loadoutPresets = [{
    loadouts: {
      removed_operator: { weapon: 'only-weapon' }
    }
  }];

  const result = applyLoadoutPreset(0, s);

  assert.equal(result.ok, true);
  assert.equal(result.skipped, 1);
  assert.equal('removed_operator' in s.loadouts, false);
  assert.equal(s.loadouts.op_weilong.weapon, 'only-weapon');
});

test('equipment loadout UI renders exactly the Command Center unlocked preset slots', () => {
  const previous = getState();
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.COMMAND_CENTER] = 9;
  s.operators = {
    unlocked: ['op_weilong'], levels: { op_weilong: 1 }, squad: ['op_weilong']
  };

  try {
    setState(s);
    setEquipSubTab('loadout');
    const html = renderEquipmentPanel();

    assert.equal((html.match(/data-loadout-preset=/g) || []).length, 3);
    assert.equal((html.match(/data-action="eq-preset-save"/g) || []).length, 3);
    assert.equal((html.match(/data-action="eq-preset-apply"/g) || []).length, 3);
  } finally {
    setState(previous);
  }
});

test('mobility grants exact march bonuses and level milestones', () => {
  const s = stateWithFacilities();

  assert.deepEqual(
    [1, 2, 3, 6, 9, 10].map((level) => {
      s.base.facilities[FACILITY.MOBILITY] = level;
      const bonuses = baseBonuses(s);
      return [
        level,
        bonuses.marchSpeed,
        bonuses.minNodeGap,
        bonuses.startPreviewNodes,
        bonuses.skipNormalEnemies
      ];
    }),
    [
      [1, 0.025, 0.6, 0, 0],
      [2, 0.05, 0.6, 0, 0],
      [3, 0.075, 0.5, 0, 0],
      [6, 0.15, 0.5, 1, 0],
      [9, 0.225, 0.5, 1, 1],
      [10, 0.25, 0.5, 1, 2]
    ]
  );
});

test('march combines snapshot mobility with operator speed under a fifty-percent cap', () => {
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.MOBILITY] = 10;
  s.operators.squad = ['op_weilong', 'op_assault_2', 'op_assault_3'];
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000, squadSnapshot: [], loadoutSnapshot: {}, maxHp: 100,
    nodeGap: 10, baseBonuses: baseBonuses(s)
  });
  setState(s);
  const originalRandom = Math.random;

  try {
    Math.random = () => 0.5;
    startMarch(s, 2_000);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(s.run.phaseDuration, 5);
  assert.equal(squadCombatStats(s).marchSpeed, 0.36);
});

test('WeiLong jetpack stays inside the total fifty-percent march reduction cap at Mobility ten', () => {
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.MOBILITY] = 10;
  s.operators.squad = ['op_weilong'];
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000,
    squadSnapshot: [{ id: 'op_weilong', name: '威龙', role: 'assault', atk: 68, hp: 420 }],
    loadoutSnapshot: {}, maxHp: 420, nodeGap: 10, baseBonuses: baseBonuses(s)
  });
  setState(s);
  const originalRandom = Math.random;

  try {
    Math.random = () => 0.5;
    startMarch(s, 2_000);
    advance(s, 2_000);
  } finally {
    Math.random = originalRandom;
  }

  const effectiveDuration = (s.run.phaseStartedAt + s.run.phaseDuration * 1_000 - 2_000) / 1_000;
  assert.equal(effectiveDuration, 5);
  assert.equal(s.run.skillRuntime.casts, 1);
  assert.match(s.run.logs[0]?.text || '', /喷气背包/);
});

test('WeiLong jetpack keeps the pre-level-three Mobility march floor at 0.6 seconds', () => {
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.MOBILITY] = 2;
  s.operators.squad = ['op_weilong'];
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000,
    squadSnapshot: [{ id: 'op_weilong', name: '威龙', role: 'assault', atk: 68, hp: 420 }],
    loadoutSnapshot: {}, maxHp: 420, nodeGap: 0.7, baseBonuses: baseBonuses(s)
  });
  setState(s);
  const originalRandom = Math.random;

  try {
    Math.random = () => 0.5;
    startMarch(s, 2_000);
    advance(s, 2_000);
  } finally {
    Math.random = originalRandom;
  }

  const effectiveDuration = (s.run.phaseStartedAt + s.run.phaseDuration * 1_000 - 2_000) / 1_000;
  assert.equal(effectiveDuration, 0.6);
  assert.equal(s.run.skillRuntime.casts, 1);
});

test('level-three mobility lowers only the node-to-node march floor to half a second', () => {
  const durations = [2, 3].map((level) => {
    const s = stateWithFacilities();
    s.base.facilities[FACILITY.MOBILITY] = level;
    s.run = createRun({
      mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
      startedAt: 1_000, squadSnapshot: [], loadoutSnapshot: {}, maxHp: 100,
      nodeGap: 0.1, baseBonuses: baseBonuses(s)
    });
    setState(s);
    const originalRandom = Math.random;
    try {
      Math.random = () => 0.5;
      startMarch(s, 2_000);
    } finally {
      Math.random = originalRandom;
    }
    return s.run.phaseDuration;
  });

  assert.deepEqual(durations, [0.6, 0.5]);
});

test('cancelling extraction resumes a capped mobility march without shortening extraction', () => {
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.MOBILITY] = 10;
  s.operators.squad = ['op_weilong', 'op_assault_2', 'op_assault_3'];
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000, squadSnapshot: [], loadoutSnapshot: {}, maxHp: 100,
    nodeGap: 10, baseBonuses: baseBonuses(s)
  });
  s.run.phase = 'extracting';
  s.run.extract = { startedAt: 2_000, duration: 12, interrupted: false };
  setState(s);
  const originalRandom = Math.random;

  try {
    Math.random = () => 0.5;
    assert.equal(extractDuration(s), 12);
    assert.equal(cancelExtraction().ok, true);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(s.run.phase, 'march');
  assert.equal(s.run.phaseDuration, 5);
  assert.equal(s.run.extract, null);
});

test('interrupted extraction resumes with the snapshotted level-three half-second floor', () => {
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.MOBILITY] = 3;
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000, squadSnapshot: [], loadoutSnapshot: {}, maxHp: 100,
    nodeGap: 0.1, baseBonuses: baseBonuses(s)
  });
  s.run.phase = 'extracting';
  s.run.extract = { startedAt: 2_000, duration: 12, interrupted: false };
  setState(s);
  const rolls = [0, 0.5];
  const originalRandom = Math.random;

  try {
    Math.random = () => rolls.shift() ?? 0.5;
    assert.equal(extractDuration(s), 12);
    assert.equal(tickExtraction(s, 3_000), false);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(s.run.phase, 'march');
  assert.equal(s.run.phaseDuration, 0.5);
  assert.equal(s.run.extract, null);
});

test('launch mobility snapshot stays stable after account upgrades', () => {
  assert.equal(typeof baseSystem.makeMobilityRunSnapshot, 'function');
  if (typeof baseSystem.makeMobilityRunSnapshot !== 'function') return;
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.MOBILITY] = 9;

  const mobility = baseSystem.makeMobilityRunSnapshot(s);
  s.base.facilities[FACILITY.MOBILITY] = 10;

  assert.deepEqual(mobility, { remainingSkips: 1, startPreviewNodes: 1 });
});

test('level-six mobility previews one extra real node only at action start', () => {
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.MOBILITY] = 6;
  const bonuses = baseBonuses(s);
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000, squadSnapshot: [], loadoutSnapshot: {}, maxHp: 100,
    nodeGap: 3, baseBonuses: bonuses,
    mobility: { remainingSkips: bonuses.skipNormalEnemies, startPreviewNodes: bonuses.startPreviewNodes }
  });
  s.run.nodeQueue = ['crate', 'enemy'];
  const branch = { weights: { crate: 1 } };

  assert.deepEqual(previewIntelNodes(s.run, branch), ['crate']);
  assert.deepEqual(s.run.nodeQueue, ['crate', 'enemy']);

  s.run.nodeIndex = 1;
  assert.deepEqual(previewIntelNodes(s.run, branch), []);
});

test('mobility consumes exactly its normal-enemy skips and never skips special enemies', () => {
  const run = { mobility: { remainingSkips: 2, startPreviewNodes: 1 } };

  for (const enemyClass of [ENEMY_CLASS.ELITE, ENEMY_CLASS.OPERATOR, ENEMY_CLASS.BOSS]) {
    assert.equal(shouldSkipNormalEnemy(run, enemyClass), false);
    assert.equal(run.mobility.remainingSkips, 2);
  }
  assert.equal(shouldSkipNormalEnemy(run, ENEMY_CLASS.NORMAL), true);
  assert.equal(run.mobility.remainingSkips, 1);
  assert.equal(shouldSkipNormalEnemy(run, ENEMY_CLASS.NORMAL), true);
  assert.equal(run.mobility.remainingSkips, 0);
  assert.equal(shouldSkipNormalEnemy(run, ENEMY_CLASS.NORMAL), false);
  assert.equal(run.mobility.remainingSkips, 0);
});

test('quick pass returns to march without combat rewards or skill triggers', () => {
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.MOBILITY] = 9;
  const bonuses = baseBonuses(s);
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000, squadSnapshot: [], loadoutSnapshot: {}, maxHp: 100,
    nodeGap: 3, baseBonuses: bonuses,
    mobility: { remainingSkips: 1, startPreviewNodes: 1 }
  });
  s.run.nodeQueue = ['enemy'];
  s.run.phaseDuration = 0;
  setState(s);
  const originalRandom = Math.random;

  try {
    Math.random = () => 0.999999;
    advance(s, 2_000);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(s.run.phase, 'march');
  assert.equal(s.run.node, null);
  assert.equal(s.run.mobility.remainingSkips, 0);
  assert.equal(s.run.counters.kills, 0);
  assert.deepEqual(s.run.carry, { hafCoin: 0, items: [] });
  assert.equal(s.run.commanderXp, 0);
  assert.equal(s.run.skillRuntime.casts, 0);
  assert.match(s.run.logs[0]?.text || '', /快速通过/);
});

test('intelligence applies exact per-level scavenge and high-crate bonuses with milestones', () => {
  const s = stateWithFacilities();

  assert.deepEqual(
    [1, 3, 6, 9, 10].map((level) => {
      s.base.facilities[FACILITY.INTELLIGENCE] = level;
      const bonuses = baseBonuses(s);
      return {
        level,
        scavengeSpeed: bonuses.scavengeSpeed,
        crateTier: bonuses.crateTier,
        previewNodes: bonuses.previewNodes,
        markBoss: bonuses.markBoss,
        redWeightBonus: bonuses.redWeightBonus
      };
    }),
    [
      { level: 1, scavengeSpeed: 0.03, crateTier: 0.02, previewNodes: 0, markBoss: false, redWeightBonus: 0 },
      { level: 3, scavengeSpeed: 0.09, crateTier: 0.06, previewNodes: 1, markBoss: false, redWeightBonus: 0 },
      { level: 6, scavengeSpeed: 0.18, crateTier: 0.12, previewNodes: 2, markBoss: false, redWeightBonus: 0 },
      { level: 9, scavengeSpeed: 0.27, crateTier: 0.18, previewNodes: 2, markBoss: true, redWeightBonus: 0 },
      { level: 10, scavengeSpeed: 0.3, crateTier: 0.2, previewNodes: 2, markBoss: true, redWeightBonus: 0.25 }
    ]
  );
});

test('run snapshot merges intelligence with skills under the scavenge cap and stays stable', () => {
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.INTELLIGENCE] = 10;
  s.skills.sk_speed = 10;
  s.skills.sk_tier = 5;
  const snapshot = baseBonuses(s);
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000, squadSnapshot: [], loadoutSnapshot: {}, maxHp: 100,
    nodeGap: 3, baseBonuses: snapshot
  });

  s.base.facilities[FACILITY.INTELLIGENCE] = 1;
  const stats = squadCombatStats(s);

  assert.notEqual(s.run.baseBonuses, snapshot);
  assert.deepEqual(s.run.baseBonuses, snapshot);
  assert.equal(stats.scavengeSpeed, 0.75);
  assert.equal(stats.crateTierBonus, 0.5);
  assert.equal(stats.redWeightBonus, 0.25);
});

test('intelligence preview renders two stable queued nodes while hiding unmarked bosses', () => {
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.INTELLIGENCE] = 6;
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000, squadSnapshot: [], loadoutSnapshot: {}, maxHp: 100,
    nodeGap: 3, baseBonuses: baseBonuses(s)
  });
  s.run.nodeQueue = ['boss', 'crate', 'enemy'];
  const before = [...s.run.nodeQueue];

  const html = renderHeader(s, 2_000);

  assert.deepEqual(s.run.nodeQueue, before);
  assert.match(html, /情报预览/);
  assert.match(html, /敌情/);
  assert.match(html, /补给箱/);
  assert.doesNotMatch(html, /首领/);
});

test('level-three intelligence renders exactly one real queued-node preview', () => {
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.INTELLIGENCE] = 3;
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000, squadSnapshot: [], loadoutSnapshot: {}, maxHp: 100,
    nodeGap: 3, baseBonuses: baseBonuses(s)
  });
  s.run.nodeQueue = ['crate', 'enemy'];
  const before = [...s.run.nodeQueue];

  const html = renderHeader(s, 2_000);

  assert.deepEqual(s.run.nodeQueue, before);
  assert.match(html, /情报预览 · 1\. 补给箱/);
  assert.doesNotMatch(html, /2\. 敌情/);
});

test('level-nine intelligence marks a queued boss without consuming or reordering it', () => {
  const s = stateWithFacilities();
  s.base.facilities[FACILITY.INTELLIGENCE] = 9;
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000, squadSnapshot: [], loadoutSnapshot: {}, maxHp: 100,
    nodeGap: 3, baseBonuses: baseBonuses(s)
  });
  s.run.nodeQueue = ['boss', 'enemy', 'crate'];

  const html = renderHeader(s, 2_000);

  assert.deepEqual(s.run.nodeQueue, ['boss', 'enemy', 'crate']);
  assert.match(html, /首领/);
  assert.match(html, /敌情/);
});

test('red weight bonus increases red weighting without guaranteeing red or removing gold', () => {
  assert.equal(typeof loot.rollCollectibleRarity, 'function');
  if (typeof loot.rollCollectibleRarity !== 'function') return;
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.13;
    assert.equal(loot.rollCollectibleRarity(RARITY.RED, 0), RARITY.LEGEND);
    assert.equal(loot.rollCollectibleRarity(RARITY.RED, 0.25), RARITY.RED);
    Math.random = () => 0;
    assert.equal(loot.rollCollectibleRarity(RARITY.RED, 0.25), RARITY.RED);
    Math.random = () => 0.999999;
    assert.equal(loot.rollCollectibleRarity(RARITY.RED, 0.25), RARITY.LEGEND);
  } finally {
    Math.random = originalRandom;
  }
});

test('facility level six unlocks level-five weapon and armor shop stock', () => {
  const s = stateWithFacilities({ armory: 6, armor: 6 });
  const stock = shopEquipmentList(s);

  assert.equal(baseBonuses(s).maxWeaponLevel, 5);
  assert.equal(baseBonuses(s).maxArmorLevel, 5);
  assert.equal(stock.find((item) => item.id === 'w_mg').locked, false);
  assert.equal(stock.find((item) => item.id === 'a_t5').locked, false);
  assert.equal(stock.find((item) => item.id === 'w_rail').locked, true);
  assert.equal(stock.find((item) => item.id === 'h_t6').locked, true);
});

test('facility level six applies a consistently rounded twelve-percent discount', () => {
  const s = stateWithFacilities({ armory: 6, armor: 6 });
  const weapon = getTemplate('w_mg');
  const armor = getTemplate('a_t5');
  const original = EQUIPMENT_TEMPLATES.map(({ id, value, price }) => ({ id, value, price }));

  assert.equal(baseBonuses(s).weaponDiscount, 0.12);
  assert.equal(baseBonuses(s).armorDiscount, 0.12);
  assert.equal(effectiveShopPrice(weapon, s), Math.round(weapon.price * 0.88));
  assert.equal(effectiveShopPrice(armor, s), Math.round(armor.price * 0.88));
  assert.equal(shopEquipmentList(s).find((item) => item.id === weapon.id).shopPrice,
    effectiveShopPrice(weapon, s));
  assert.deepEqual(
    EQUIPMENT_TEMPLATES.map(({ id, value, price }) => ({ id, value, price })),
    original
  );
});

test('direct purchase rejects locked level-six gear without charging or granting it', () => {
  const s = stateWithFacilities({ armory: 6, armor: 6 });
  s.currency.hafCoin = 10_000_000;
  setState(s);
  const before = structuredClone(s);

  const result = buyEquipment('w_rail', s);

  assert.equal(result.ok, false);
  assert.match(result.msg, /军械台.*9/);
  assert.deepEqual(s, before);
});

test('direct purchase charges the rounded facility price without changing readiness or templates', () => {
  const s = stateWithFacilities({ armory: 6 });
  s.currency.hafCoin = 1_000_000;
  setState(s);
  const tpl = getTemplate('w_mg');
  const expectedPrice = Math.round(tpl.price * 0.88);
  const templateBefore = { value: tpl.value, price: tpl.price };
  const readinessBefore = getReadiness(s);

  const result = buyEquipment(tpl.id, s);

  assert.equal(result.ok, true);
  assert.equal(result.price, expectedPrice);
  assert.equal(s.currency.hafCoin, 1_000_000 - expectedPrice);
  assert.ok(s.inventory.some((item) => item.tplId === tpl.id));
  assert.equal(getReadiness(s), readinessBefore);
  assert.deepEqual({ value: tpl.value, price: tpl.price }, templateBefore);
});

test('legacy higher-tier equipment remains usable below its current purchase gate', () => {
  const s = stateWithFacilities();
  s.operators.squad = ['legacy'];
  s.inventory.push({ uid: 'legacy-rail', tplId: 'w_rail', slot: 'weapon' });

  const result = equip('legacy-rail', 'legacy', s);

  assert.equal(result.ok, true);
  assert.equal(s.loadouts.legacy.weapon, 'legacy-rail');
});

test('shop keeps locked equipment cards visible with their facility requirement', () => {
  const s = stateWithFacilities();
  setState(s);
  setEquipSubTab('shop');

  const html = renderEquipmentPanel();

  assert.match(html, /M82A1/);
  assert.match(html, /军械台 Lv\.9 解锁/);
  assert.match(html, /6 级外骨骼装甲/);
  assert.match(html, /防具台 Lv\.9 解锁/);
});

test('storage adds ten slots per level and counts equipment instances plus non-empty stack types', () => {
  const s = stateWithFacilities({ storage: 4 });
  s.inventory = [
    { uid: 'eq-a', tplId: 'w_ak', slot: 'weapon' },
    { uid: 'eq-b', tplId: 'w_ak', slot: 'weapon' }
  ];
  s.materials = { m_can: 12, m_ssd: 1, ignored_empty: 0 };
  s.collectibles = { c_coffee: 3 };
  s.ammo = { am_t2: 240, am_t3: 30, ignored_empty: 0 };

  assert.equal(warehouseCapacity(s), 50);
  assert.equal(warehouseUsed(s), 7);
  assert.equal(warehouseFree(s), 43);

  s.base.facilities[FACILITY.STORAGE] = 5;
  assert.equal(warehouseCapacity(s), 60);
  assert.equal(warehouseFree(s), 53);
});

test('save sanitization preserves unknown legacy warehouse equipment and ammo with slot accounting', () => {
  const s = stateWithFacilities({ storage: 1 });
  s.inventory = [
    { uid: 'legacy-eq', tplId: 'removed_equipment', slot: 'weapon' },
    { uid: 'legacy-eq-no-slot', tplId: 'removed_equipment_without_slot' }
  ];
  s.materials = {};
  s.collectibles = {};
  s.ammo = { removed_ammo: 45 };

  const clean = sanitizeState(structuredClone(s));

  assert.deepEqual(clean.inventory, [
    { uid: 'legacy-eq', tplId: 'removed_equipment', slot: 'weapon' },
    { uid: 'legacy-eq-no-slot', tplId: 'removed_equipment_without_slot', slot: 'legacy' }
  ]);
  assert.deepEqual(clean.ammo, { removed_ammo: 45 });
  assert.equal(warehouseUsed(clean), 3);
});

test('unknown legacy equipment and ammo stay visible until explicitly discarded', () => {
  const s = stateWithFacilities({ storage: 1 });
  s.inventory = [{ uid: 'legacy-eq', tplId: 'removed_equipment', slot: 'weapon' }];
  s.materials = {};
  s.collectibles = {};
  s.ammo = { removed_ammo: 45 };
  const clean = sanitizeState(structuredClone(s));

  setWarehouseCat('equipment');
  const equipmentHtml = renderWarehousePanel(clean);
  assert.match(equipmentHtml, /removed_equipment/);
  assert.match(equipmentHtml, /data-action="wh-discard-legacy-eq"/);

  setWarehouseCat('ammo');
  const ammoHtml = renderWarehousePanel(clean);
  assert.match(ammoHtml, /removed_ammo/);
  assert.match(ammoHtml, /45 发/);
  assert.match(ammoHtml, /data-action="wh-discard-legacy-ammo"/);

  assert.equal(discardLegacyEquipment('legacy-eq', clean).ok, true);
  assert.equal(discardLegacyAmmo('removed_ammo', clean).ok, true);
  assert.equal(warehouseUsed(clean), 0);
});

test('manual equipment candidates exclude retained unknown legacy equipment without crashing', () => {
  const s = stateWithFacilities();
  s.inventory = [{ uid: 'legacy-eq', tplId: 'removed_equipment', slot: 'weapon' }];
  const clean = sanitizeState(structuredClone(s));

  assert.deepEqual(candidatesForSlot('weapon', 'operator-a', clean), []);
  assert.deepEqual(clean.inventory, [
    { uid: 'legacy-eq', tplId: 'removed_equipment', slot: 'weapon' }
  ]);
});

test('direct equip rejects retained unknown legacy equipment without mutation', () => {
  const s = stateWithFacilities();
  s.inventory = [{ uid: 'legacy-eq', tplId: 'removed_equipment', slot: 'weapon' }];
  const clean = sanitizeState(structuredClone(s));
  const before = structuredClone(clean);

  const result = equip('legacy-eq', 'operator-a', clean);

  assert.equal(result.ok, false);
  assert.deepEqual(clean, before);
});

test('auto-equip leaves retained unknown legacy equipment stored and unequipped', () => {
  const s = stateWithFacilities();
  s.inventory = [{ uid: 'legacy-eq', tplId: 'removed_equipment', slot: 'weapon' }];
  const clean = sanitizeState(structuredClone(s));

  const result = autoEquipBest('operator-a', clean);

  assert.equal(result.ok, true);
  assert.equal(clean.loadouts['operator-a'].weapon, null);
  assert.deepEqual(clean.inventory, [
    { uid: 'legacy-eq', tplId: 'removed_equipment', slot: 'weapon' }
  ]);
});

test('safebox candidates exclude retained unknown legacy equipment without crashing', () => {
  const s = stateWithFacilities();
  s.inventory = [
    { uid: 'legacy-eq', tplId: 'removed_equipment', slot: 'weapon' },
    { uid: 'known-eq', tplId: 'w_ak', slot: 'weapon' }
  ];
  const clean = sanitizeState(structuredClone(s));

  const available = safeboxCandidates(clean);

  assert.deepEqual(available.equipment.map((item) => item.srcUid), ['known-eq']);
  assert.equal(clean.inventory.some((item) => item.uid === 'legacy-eq'), true);
});

test('direct safebox deposit rejects retained unknown legacy equipment without mutation', () => {
  const s = stateWithFacilities();
  s.inventory = [{ uid: 'legacy-eq', tplId: 'removed_equipment', slot: 'weapon' }];
  const clean = sanitizeState(structuredClone(s));
  const before = structuredClone(clean);

  const result = depositSafeboxEquipment('legacy-eq', clean);

  assert.equal(result.ok, false);
  assert.match(result.msg, /未知|异常|不存在/);
  assert.deepEqual(clean, before);
});

test('storage levels three, six, and nine each add one safebox slot', () => {
  const s = stateWithFacilities({ storage: 2 });

  assert.equal(baseBonuses(s).safeboxSlots, 0);
  assert.equal(safeboxCapacity(s), 3);
  s.base.facilities[FACILITY.STORAGE] = 3;
  assert.equal(baseBonuses(s).safeboxSlots, 1);
  assert.equal(safeboxCapacity(s), 4);
  s.base.facilities[FACILITY.STORAGE] = 6;
  assert.equal(baseBonuses(s).safeboxSlots, 2);
  assert.equal(safeboxCapacity(s), 5);
  s.base.facilities[FACILITY.STORAGE] = 9;
  assert.equal(baseBonuses(s).safeboxSlots, 3);
  assert.equal(safeboxCapacity(s), 6);
});

test('batch selling is locked before storage level five and sells a category atomically once unlocked', () => {
  const s = stateWithFacilities({ storage: 4 });
  s.inventory = [
    { uid: 'sell-a', tplId: 'w_ak', slot: 'weapon' },
    { uid: 'sell-b', tplId: 'w_m4', slot: 'weapon' },
    { uid: 'boxed', tplId: 'w_rail', slot: 'weapon' }
  ];
  s.safebox.items = [{ uid: 'box-ref', srcUid: 'boxed', kind: LOOT_KIND.EQUIPMENT }];
  s.currency.hafCoin = 100;
  const before = structuredClone(s);

  const locked = batchSellWarehouseCategory('equipment', s);

  assert.equal(locked.ok, false);
  assert.deepEqual(s, before);

  s.base.facilities[FACILITY.STORAGE] = 5;
  const sold = batchSellWarehouseCategory('equipment', s);
  const expectedGain = Math.floor(getTemplate('w_ak').value * 0.6)
    + Math.floor(getTemplate('w_m4').value * 0.6);

  assert.equal(sold.ok, true);
  assert.equal(sold.sold, 2);
  assert.equal(sold.gain, expectedGain);
  assert.deepEqual(s.inventory.map((item) => item.uid), ['boxed']);
  assert.equal(s.currency.hafCoin, 100 + expectedGain);
});

test('equipment batch sale preserves unknown legacy items for explicit discard', () => {
  const s = stateWithFacilities({ storage: 5 });
  s.inventory = [
    { uid: 'legacy-eq', tplId: 'removed_equipment', slot: 'weapon' },
    { uid: 'known-eq', tplId: 'w_ak', slot: 'weapon' }
  ];
  s.currency.hafCoin = 100;
  const expectedGain = Math.floor(getTemplate('w_ak').value * 0.6);

  const result = batchSellWarehouseCategory('equipment', s);

  assert.equal(result.ok, true);
  assert.equal(result.sold, 1);
  assert.equal(result.gain, expectedGain);
  assert.deepEqual(s.inventory, [
    { uid: 'legacy-eq', tplId: 'removed_equipment', slot: 'weapon' }
  ]);
  assert.equal(s.currency.hafCoin, 100 + expectedGain);
});

test('unknown legacy ammo survives auto-sort and batch sale until explicit discard', () => {
  const s = stateWithFacilities({ storage: 8 });
  s.inventory = [];
  s.materials = {};
  s.collectibles = {};
  s.ammo = { removed_ammo: 45, am_t2: 30 };

  assert.equal(autoSortWarehouse(s).ok, true);
  assert.equal(s.ammo.removed_ammo, 45);

  const sold = batchSellWarehouseCategory('ammo', s);

  assert.equal(sold.ok, true);
  assert.equal(sold.sold, 30);
  assert.deepEqual(s.ammo, { removed_ammo: 45 });
  assert.equal(warehouseUsed(s), 1);
  assert.equal(discardLegacyAmmo('removed_ammo', s).ok, true);
  assert.deepEqual(s.ammo, {});
});

test('batch selling preserves material quantities referenced by the safebox', () => {
  const s = stateWithFacilities({ storage: 5 });
  s.inventory = [];
  s.materials = { m_can: 6 };
  s.safebox.items = [{
    uid: 'box-material', srcUid: null, kind: LOOT_KIND.MATERIAL, tplId: 'm_can', count: 2
  }];

  const result = batchSellWarehouseCategory('material', s);

  assert.equal(result.ok, true);
  assert.equal(result.sold, 4);
  assert.equal(s.materials.m_can, 2);
});

test('auto-sort unlocks at storage level eight and is stable by category, rarity, then value', () => {
  const entries = [
    { marker: 'material', kind: LOOT_KIND.MATERIAL, rarity: 'red', value: 9_999 },
    { marker: 'low-a', kind: LOOT_KIND.EQUIPMENT, rarity: 'common', value: 150 },
    { marker: 'rare', kind: LOOT_KIND.EQUIPMENT, rarity: 'rare', value: 780 },
    { marker: 'low-b', kind: LOOT_KIND.EQUIPMENT, rarity: 'common', value: 150 },
    { marker: 'ammo', kind: LOOT_KIND.AMMO, rarity: 'epic', value: 2_000 }
  ];
  assert.deepEqual(
    stableWarehouseSort(entries).map((item) => item.marker),
    ['rare', 'low-a', 'low-b', 'ammo', 'material']
  );

  const s = stateWithFacilities({ storage: 7 });
  s.inventory = [
    { uid: 'low-a', tplId: 'w_car15', slot: 'weapon' },
    { uid: 'rare', tplId: 'w_m4', slot: 'weapon' },
    { uid: 'high-common', tplId: 'w_ak', slot: 'weapon' },
    { uid: 'low-b', tplId: 'w_car15', slot: 'weapon' }
  ];
  const before = structuredClone(s.inventory);
  assert.equal(autoSortWarehouse(s).ok, false);
  assert.deepEqual(s.inventory, before);

  s.base.facilities[FACILITY.STORAGE] = 8;
  assert.equal(autoSortWarehouse(s).ok, true);
  assert.deepEqual(s.inventory.map((item) => item.uid), ['rare', 'high-common', 'low-a', 'low-b']);
});

function extractionStateWithOneFreeSlot() {
  const s = stateWithFacilities({ storage: 1 });
  s.inventory = Array.from({ length: 19 }, (_, index) => ({
    uid: `stored-${index}`,
    tplId: 'w_ak',
    slot: 'weapon'
  }));
  s.materials = {};
  s.collectibles = {};
  s.ammo = {};
  s.run = createRun({
    mapId: 'dam',
    difficulty: DIFFICULTY.NORMAL,
    timeLimit: 120,
    startedAt: Date.now() - 1_000,
    squadSnapshot: [],
    loadoutSnapshot: {},
    maxHp: 100,
    nodeGap: 3,
    commanderXp: 400
  });
  s.run.carry.items = [
    {
      uid: 'loot-stored', kind: LOOT_KIND.EQUIPMENT, tplId: 'w_m4',
      name: 'M4A1 突击步枪', rarity: 'rare', count: 1, value: 780
    },
    {
      uid: 'loot-pending', kind: LOOT_KIND.EQUIPMENT, tplId: 'w_rail',
      name: 'M82A1 狙击步枪', rarity: 'red', count: 1, value: 11_200
    }
  ];
  return s;
}

function fullWarehousePendingRedState(count = 1) {
  const s = stateWithFacilities({ storage: 1 });
  s.inventory = Array.from({ length: 20 }, (_, index) => ({
    uid: `full-red-${index}`,
    tplId: 'w_ak',
    slot: 'weapon'
  }));
  s.materials = {};
  s.collectibles = {};
  s.ammo = {};
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: Date.now() - 1_000, squadSnapshot: [], loadoutSnapshot: {},
    maxHp: 100, nodeGap: 3
  });
  const collectible = getCollectible('c_gpu');
  s.run.carry.items = Array.from({ length: count }, (_, index) => ({
    uid: `pending-red-${index + 1}`,
    kind: LOOT_KIND.COLLECTIBLE,
    tplId: collectible.id,
    name: collectible.name,
    rarity: collectible.rarity,
    count: 1,
    value: collectible.value
  }));
  return s;
}

test('full warehouse blocks selling or discarding the sole pending protected red', () => {
  for (const action of ['sell', 'discard']) {
    const s = fullWarehousePendingRedState();
    setState(s);
    const result = settle({ success: true, reason: null });
    const before = structuredClone(s);

    const outcome = resolveSettlementOverflow('pending-red-1', action, s);

    assert.equal(outcome.ok, false, action);
    assert.match(outcome.msg, /首件|保护/, action);
    assert.deepEqual(s, before, action);
    assert.equal(result.pendingItems.length, 1, action);
  }
});

test('full warehouse stores the sole pending red through the protected-copy exception', () => {
  const s = fullWarehousePendingRedState();
  setState(s);
  const result = settle({ success: true, reason: null });

  const outcome = resolveSettlementOverflow('pending-red-1', 'store', s);

  assert.equal(outcome.ok, true);
  assert.match(outcome.msg, /保护|入库/);
  assert.equal(result.pendingItems.length, 0);
  assert.equal(s.collectibles.c_gpu, 1);
  assert.equal(baseSystem.protectedCollectibleCount('c_gpu', s), 1);
  assert.equal(baseSystem.consumableCollectibleCount('c_gpu', s), 0);
  assert.equal(warehouseUsed(s), warehouseCapacity(s) + 1);
  assert.equal(!!s.gallery.c_gpu, true);
});

test('duplicate pending reds remain sellable or discardable while one copy stays protected', () => {
  for (const action of ['sell', 'discard']) {
    const s = fullWarehousePendingRedState(2);
    setState(s);
    const result = settle({ success: true, reason: null });
    const coinBefore = s.currency.hafCoin;

    const outcome = resolveSettlementOverflow('pending-red-1', action, s);

    assert.equal(outcome.ok, true, action);
    assert.equal(result.pendingItems.length, 1, action);
    assert.equal(result.pendingItems[0].uid, 'pending-red-2', action);
    assert.equal(s.collectibles.c_gpu, undefined, action);
    assert.equal(
      s.currency.hafCoin,
      action === 'sell' ? coinBefore + getCollectible('c_gpu').value : coinBefore,
      action
    );
  }
});

test('settlement UI marks a sole pending red as protected and disables destructive actions', () => {
  const s = fullWarehousePendingRedState();
  setState(s);
  const result = settle({ success: true, reason: null });

  const html = renderSettlementBody(result);

  assert.match(html, /首件大红保护/);
  assert.match(html, /data-settle-overflow="sell"[^>]*disabled/);
  assert.match(html, /data-settle-overflow="discard"[^>]*disabled/);
  assert.match(html, /data-settle-overflow="store"/);
});

test('successful extraction preserves overflow in settlement until explicit resolution without losing XP', () => {
  const s = extractionStateWithOneFreeSlot();
  setState(s);

  const result = settle({ success: true, reason: null });

  assert.equal(warehouseUsed(s), 20);
  assert.deepEqual(result.pendingItems.map((item) => item.uid), ['loot-pending']);
  assert.equal(result.commanderXp.earned, 500);
  assert.equal(s.commander.level, 2);
  assert.equal(s.commander.totalXp, 500);
  assert.equal(dismissSettlement().ok, false);
  assert.equal(s.lastSettlement, result);

  const coinBefore = s.currency.hafCoin;
  const resolved = resolveSettlementOverflow('loot-pending', 'sell', s);

  assert.equal(resolved.ok, true);
  assert.equal(result.pendingItems.length, 0);
  assert.equal(s.currency.hafCoin, coinBefore + Math.floor(getTemplate('w_rail').value * 0.6));
  assert.equal(s.commander.totalXp, 500);
  assert.equal(result.commanderXp.earned, 500);
  assert.equal(dismissSettlement().ok, true);
  assert.equal(s.lastSettlement, null);
});

test('pending extraction overflow survives save sanitization instead of being truncated', () => {
  const s = extractionStateWithOneFreeSlot();
  setState(s);
  settle({ success: true, reason: null });

  const clean = sanitizeState(structuredClone(s));

  assert.deepEqual(clean.lastSettlement.pendingItems.map((item) => item.uid), ['loot-pending']);
  assert.equal(clean.lastSettlement.commanderXp.earned, 500);
});

test('save sanitization gives missing pending overflow ids a stable resolvable identity', () => {
  const s = stateWithFacilities({ storage: 1 });
  s.inventory = [];
  s.materials = {};
  s.collectibles = {};
  s.ammo = {};
  s.lastSettlement = {
    success: true,
    gainedItems: [],
    pendingItems: [{
      kind: LOOT_KIND.EQUIPMENT,
      tplId: 'w_m4',
      name: 'M4A1 突击步枪',
      rarity: 'rare',
      count: 1,
      value: 780
    }],
    keptItems: [],
    lostItems: [],
    keptValue: 0,
    overflowValue: 780,
    hafCoinGained: 0
  };

  const clean = sanitizeState(structuredClone(s));
  const pendingUid = clean.lastSettlement.pendingItems[0].uid;

  assert.equal(pendingUid, 'settlement-pending-1');
  assert.equal(
    sanitizeState(structuredClone(clean)).lastSettlement.pendingItems[0].uid,
    pendingUid
  );
  assert.match(renderSettlementBody(clean.lastSettlement), new RegExp(`data-uid="${pendingUid}"`));

  setState(clean);
  assert.equal(resolveSettlementOverflow(pendingUid, 'store', clean).ok, true);
  assert.equal(clean.lastSettlement.pendingItems.length, 0);
  assert.equal(clean.inventory.some((item) => item.tplId === 'w_m4'), true);
});

test('save sanitization de-duplicates pending overflow ids so every item can be resolved', () => {
  const s = stateWithFacilities({ storage: 1 });
  s.inventory = [];
  s.materials = {};
  s.collectibles = {};
  s.ammo = {};
  s.lastSettlement = {
    success: true,
    gainedItems: [],
    pendingItems: [
      {
        uid: 'legacy-duplicate', kind: LOOT_KIND.EQUIPMENT, tplId: 'w_m4',
        name: 'M4A1 突击步枪', rarity: 'rare', count: 1, value: 780
      },
      {
        uid: 'legacy-duplicate', kind: LOOT_KIND.EQUIPMENT, tplId: 'w_ak',
        name: 'AKM 突击步枪', rarity: 'common', count: 1, value: 320
      }
    ],
    keptItems: [],
    lostItems: [],
    keptValue: 0,
    overflowValue: 1_100,
    hafCoinGained: 0
  };

  const clean = sanitizeState(structuredClone(s));
  const pendingUids = clean.lastSettlement.pendingItems.map((item) => item.uid);

  assert.deepEqual(pendingUids, ['legacy-duplicate', 'legacy-duplicate-2']);
  assert.deepEqual(
    sanitizeState(structuredClone(clean)).lastSettlement.pendingItems.map((item) => item.uid),
    pendingUids
  );

  setState(clean);
  assert.equal(resolveSettlementOverflow(pendingUids[0], 'sell', clean).ok, true);
  assert.equal(resolveSettlementOverflow(pendingUids[1], 'discard', clean).ok, true);
  assert.equal(clean.lastSettlement.pendingItems.length, 0);
});

test('warehouse UI shows capacity and unlock-gated batch sell and auto-sort controls', () => {
  const s = stateWithFacilities({ storage: 4 });
  s.inventory = [{ uid: 'stored', tplId: 'w_ak', slot: 'weapon' }];
  s.materials = {};
  s.collectibles = {};
  s.ammo = {};
  setWarehouseCat('equipment');

  const locked = renderWarehousePanel(s);
  assert.match(locked, /1\s*\/\s*50/);
  assert.match(locked, /5 级解锁批量出售/);
  assert.match(locked, /8 级解锁自动整理/);
  assert.doesNotMatch(locked, /data-action="wh-batch-sell"/);

  s.base.facilities[FACILITY.STORAGE] = 8;
  const unlocked = renderWarehousePanel(s);
  assert.match(unlocked, /data-action="wh-batch-sell"/);
  assert.match(unlocked, /data-action="wh-auto-sort"/);
});

test('settlement UI requires each pending overflow item to be stored, sold, or discarded', () => {
  const s = extractionStateWithOneFreeSlot();
  setState(s);
  const result = settle({ success: true, reason: null });

  const html = renderSettlementBody(result);

  assert.match(html, /待处理撤离物资/);
  assert.match(html, /M82A1 狙击步枪/);
  assert.match(html, /data-settle-overflow="store"/);
  assert.match(html, /data-settle-overflow="sell"/);
  assert.match(html, /data-settle-overflow="discard"/);
});

test('shop purchases cannot exceed capacity but may add to an existing stack while full', () => {
  const s = stateWithFacilities({ storage: 1 });
  s.inventory = Array.from({ length: 19 }, (_, index) => ({
    uid: `full-${index}`, tplId: 'w_ak', slot: 'weapon'
  }));
  s.materials = { m_can: 1 };
  s.collectibles = {};
  s.ammo = {};
  s.currency.hafCoin = 1_000_000;
  setState(s);

  const equipmentBefore = structuredClone(s);
  const equipment = buyEquipment('w_ak', s);
  assert.equal(equipment.ok, false);
  assert.match(equipment.msg, /仓库.*满|容量/);
  assert.deepEqual(s, equipmentBefore);

  const stacked = buyMaterial('m_can', 2, s);
  assert.equal(stacked.ok, true);
  assert.equal(s.materials.m_can, 3);
  assert.equal(warehouseUsed(s), 20);

  const newStackBefore = structuredClone(s);
  const newStack = buyMaterial('m_ssd', 1, s);
  assert.equal(newStack.ok, false);
  assert.match(newStack.msg, /仓库.*满|容量/);
  assert.deepEqual(s, newStackBefore);
});

test('unused extracted ammo also remains pending when its returned stack cannot fit', () => {
  const s = stateWithFacilities({ storage: 1 });
  s.inventory = Array.from({ length: 20 }, (_, index) => ({
    uid: `full-${index}`, tplId: 'w_ak', slot: 'weapon'
  }));
  s.materials = {};
  s.collectibles = {};
  s.ammo = {};
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: Date.now() - 1_000, squadSnapshot: [], loadoutSnapshot: {},
    maxHp: 100, nodeGap: 3,
    ammo: { ammoId: 'am_t2', name: '2 级标准弹', level: 2, rounds: 30, maxRounds: 30, spent: 0 }
  });
  setState(s);

  const result = settle({ success: true, reason: null });

  assert.equal(s.ammo.am_t2, undefined);
  assert.equal(result.ammoReturned, 0);
  assert.equal(result.pendingItems.length, 1);
  assert.equal(result.pendingItems[0].kind, LOOT_KIND.AMMO);
  assert.equal(result.pendingItems[0].count, 30);
});

test('legacy regeneration skill keeps its id and level contract while becoming tactical medical healing', () => {
  const node = SKILL_NODES.find((entry) => entry.id === 'sk_regen');
  const s = stateWithFacilities();
  s.skills.sk_regen = 4;

  assert.equal(node?.name, '战术救护');
  assert.deepEqual(node?.effect, { type: 'medicalHealPct', per: 0.03 });
  assert.equal(skillBonuses(s).medicalHealPct, 0.12);
  assert.equal('regenPct' in skillBonuses(s), false);
});

test('legacy skill upgrade keeps its saved level and exact linear cost after migration', () => {
  const s = stateWithFacilities();
  s.skills.sk_atk = 2;
  s.currency.hafCoin = 1_000;
  setState(s);

  const result = upgradeSkill('sk_atk', s);

  assert.deepEqual(result, { ok: true, msg: '火力压制 提升至 Lv.3', level: 3 });
  assert.equal(s.skills.sk_atk, 3);
  assert.equal(s.currency.hafCoin, 220);
});

test('medical facility grants five-percent healing per level and extra uses at levels three six and nine', () => {
  const s = stateWithFacilities();

  assert.deepEqual(
    [1, 2, 3, 6, 9, 10].map((level) => {
      s.base.facilities[FACILITY.MEDICAL] = level;
      const bonuses = baseBonuses(s);
      return [level, bonuses.medicalHealPct, bonuses.medicalExtraUses];
    }),
    [
      [1, 0.05, 0],
      [2, 0.10, 0],
      [3, 0.15, 1],
      [6, 0.30, 2],
      [9, 0.45, 3],
      [10, 0.50, 3]
    ]
  );
});

test('medical facility adds exact squad health and accelerates only normal rescue channels', () => {
  const s = stateWithFacilities();
  s.operators.squad = ['op_weilong'];

  s.base.facilities[FACILITY.MEDICAL] = 1;
  assert.equal(baseBonuses(s).medicalHpPct, 0.02);
  assert.equal(baseBonuses(s).medicalReviveSpeed, 0.04);
  assert.equal(squadCombatStats(s).hp, 428);

  s.base.facilities[FACILITY.MEDICAL] = 10;
  assert.equal(baseBonuses(s).medicalHpPct, 0.2);
  assert.equal(baseBonuses(s).medicalReviveSpeed, 0.4);
  assert.equal(squadCombatStats(s).hp, 504);

  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000,
    squadSnapshot: [
      { id: 'rescuer', name: '救援者', role: 'assault', hp: 100 },
      { id: 'fallen', name: '倒地者', role: 'assault', hp: 100 }
    ],
    loadoutSnapshot: {}, maxHp: 200, nodeGap: 3, baseBonuses: baseBonuses(s)
  });
  s.run.members[1].hp = 0;
  s.run.members[1].downed = true;
  s.run.members[1].downedAt = 500;
  operatorSkills.tickCombatOperatorSkills(s, { hp: 100, maxHp: 100, def: 0 }, 2_000);
  assert.equal(s.run.skillRuntime.status.reviveChannel.duration, 5.714285714285714);

  const butterfly = stateWithFacilities();
  butterfly.base.facilities[FACILITY.MEDICAL] = 10;
  butterfly.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000,
    squadSnapshot: [
      { id: 'op_die', name: '蝶', role: 'support', hp: 100 },
      { id: 'fallen', name: '倒地者', role: 'assault', hp: 100 }
    ],
    loadoutSnapshot: {}, maxHp: 200, nodeGap: 3, baseBonuses: baseBonuses(butterfly)
  });
  butterfly.run.members[1].hp = 0;
  butterfly.run.members[1].downed = true;
  butterfly.run.members[1].downedAt = 500;
  operatorSkills.tickCombatOperatorSkills(
    butterfly, { hp: 100, maxHp: 100, def: 0 }, 2_000
  );
  assert.equal(butterfly.run.skillRuntime.status.reviveChannel.duration, 4.5);
});

test('permanent account attack bonus is capped at twenty percent', () => {
  const s = stateWithFacilities();
  s.operators.squad = ['op_weilong'];
  s.ammoLoadout.rounds = 0;
  s.skills.sk_atk = 10;

  assert.equal(skillBonuses(s).atkPct, 0.5);
  assert.equal(squadCombatStats(s).atk, 82);
});

test('launch medical snapshot requires equipped healing gear and caps facility plus legacy skill bonus at fifty percent', () => {
  assert.equal(typeof baseSystem.makeMedicalRunSnapshot, 'function');
  if (typeof baseSystem.makeMedicalRunSnapshot !== 'function') return;

  const s = stateWithFacilities();
  s.base.facilities[FACILITY.MEDICAL] = 9;
  s.skills.sk_regen = 6;
  s.operators.squad = ['op_test'];
  s.inventory = [{ uid: 'medkit-1', tplId: 't_med', slot: 'tactical' }];
  s.loadouts = { op_test: { tactical: 'medkit-1' } };
  const loadoutSnapshot = { op_test: { tactical: 'medkit-1' } };

  const medical = baseSystem.makeMedicalRunSnapshot(loadoutSnapshot, s);

  assert.deepEqual(medical, { maxUses: 4, remainingUses: 4, healRatio: 0.27 });
  assert.equal(squadCombatStats(s).medicalHealPct, 0.5);

  s.base.facilities[FACILITY.MEDICAL] = 1;
  s.skills.sk_regen = 0;
  s.loadouts.op_test.tactical = null;
  assert.deepEqual(medical, { maxUses: 4, remainingUses: 4, healRatio: 0.27 });
  assert.deepEqual(baseSystem.makeMedicalRunSnapshot({ op_test: { tactical: null } }, s), {
    maxUses: 0, remainingUses: 0, healRatio: 0
  });
});

function medicalRun(members, medical = { maxUses: 4, remainingUses: 4, healRatio: 0.2 }) {
  const maxHp = members.reduce((sum, member) => sum + member.maxHp, 0);
  return {
    members: structuredClone(members),
    squadSnapshot: members.map(({ id, name, maxHp }) => ({ id, name, hp: maxHp })),
    maxHp,
    hp: members.reduce((sum, member) => sum + member.hp, 0),
    medical: { ...medical }
  };
}

test('automatic medical healing triggers strictly below half health and targets the lowest-ratio living member', () => {
  assert.equal(typeof operatorSkills.tryAutoMedical, 'function');
  if (typeof operatorSkills.tryAutoMedical !== 'function') return;

  const run = medicalRun([
    { id: 'downed', name: '倒地者', maxHp: 200, hp: 0, downed: true },
    { id: 'half', name: '半血', maxHp: 100, hp: 50, downed: false },
    { id: 'lowest', name: '最低比例', maxHp: 200, hp: 80, downed: false },
    { id: 'other', name: '另一人', maxHp: 100, hp: 45, downed: false }
  ]);

  const result = operatorSkills.tryAutoMedical(run, 10_000);

  assert.deepEqual(result, { used: true, targetId: 'lowest', amount: 40 });
  assert.equal(run.members[0].hp, 0);
  assert.equal(run.members[1].hp, 50);
  assert.equal(run.members[2].hp, 120);
  assert.equal(run.members[3].hp, 45);
  assert.equal(run.medical.remainingUses, 3);
  assert.equal(run.hp, 215);
});

test('automatic medical healing is inert without uses or when every living member is at least half health', () => {
  assert.equal(typeof operatorSkills.tryAutoMedical, 'function');
  if (typeof operatorSkills.tryAutoMedical !== 'function') return;

  const healthy = medicalRun([
    { id: 'half', name: '半血', maxHp: 100, hp: 50, downed: false },
    { id: 'healthy', name: '健康', maxHp: 100, hp: 90, downed: false }
  ]);
  const noItem = medicalRun(
    [{ id: 'hurt', name: '受伤', maxHp: 100, hp: 20, downed: false }],
    { maxUses: 0, remainingUses: 0, healRatio: 0 }
  );

  assert.deepEqual(operatorSkills.tryAutoMedical(healthy, 20_000), { used: false });
  assert.deepEqual(operatorSkills.tryAutoMedical(noItem, 20_000), { used: false });
  assert.equal(healthy.medical.remainingUses, 4);
  assert.equal(noItem.members[0].hp, 20);
});

test('automatic medical healing consumes at most one use for the same combat tick', () => {
  assert.equal(typeof operatorSkills.tryAutoMedical, 'function');
  if (typeof operatorSkills.tryAutoMedical !== 'function') return;

  const run = medicalRun([
    { id: 'first', name: '一号', maxHp: 100, hp: 10, downed: false },
    { id: 'second', name: '二号', maxHp: 100, hp: 20, downed: false }
  ]);

  assert.deepEqual(operatorSkills.tryAutoMedical(run, 30_000), {
    used: true, targetId: 'first', amount: 20
  });
  assert.deepEqual(operatorSkills.tryAutoMedical(run, 30_000), { used: false });
  assert.equal(run.medical.remainingUses, 3);
  assert.deepEqual(operatorSkills.tryAutoMedical(run, 30_001), {
    used: true, targetId: 'second', amount: 20
  });
  assert.equal(run.medical.remainingUses, 2);
});

test('combat invokes automatic medical healing after damage sync and only once across catch-up rounds', () => {
  const s = stateWithFacilities();
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000,
    squadSnapshot: [{ id: 'op_test', name: '测试干员', hp: 100, atk: 1, def: 0 }],
    loadoutSnapshot: {}, maxHp: 100, nodeGap: 3,
    medical: { maxUses: 2, remainingUses: 2, healRatio: 0.2 }
  });
  s.run.phase = 'combat';
  s.run.node = {
    kind: 'enemy', interval: 0.1, lastTickAt: 9_000,
    enemy: {
      cls: ENEMY_CLASS.NORMAL, name: '测试目标', hp: 1_000, maxHp: 1_000,
      atk: 14, def: 0, armorLevel: 1, ammoLevel: 1,
      lootTier: RARITY.COMMON, carried: [], skills: []
    }
  };
  setState(s);
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.5;
    advance(s, 10_000);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(s.run.members[0].hp, 64);
  assert.equal(s.run.hp, 64);
  assert.equal(s.run.medical.remainingUses, 1);
  assert.equal(s.run.fx.filter((fx) => fx.type === 'medical-heal').length, 1);
});

test('confirmed kills never heal members or consume tactical medical uses', () => {
  const s = stateWithFacilities();
  s.skills.sk_regen = 6;
  s.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.NORMAL, timeLimit: 120,
    startedAt: 1_000,
    squadSnapshot: [{ id: 'op_test', name: '测试干员', hp: 100, atk: 10, def: 0 }],
    loadoutSnapshot: {}, maxHp: 100, nodeGap: 3, bagCapacity: 0,
    medical: { maxUses: 4, remainingUses: 4, healRatio: 0.27 }
  });
  s.run.members[0].hp = 20;
  s.run.hp = 20;
  s.run.phase = 'combat';
  s.run.node = {
    kind: 'enemy', interval: 0.1, lastTickAt: 9_000,
    enemy: {
      cls: ENEMY_CLASS.NORMAL, name: '测试目标', hp: 0, maxHp: 100,
      atk: 1, def: 0, lootTier: RARITY.COMMON, carried: [], skills: []
    }
  };
  setState(s);

  advance(s, 10_000);

  assert.equal(s.run.members[0].hp, 20);
  assert.equal(s.run.hp, 20);
  assert.equal(s.run.medical.remainingUses, 4);
});
