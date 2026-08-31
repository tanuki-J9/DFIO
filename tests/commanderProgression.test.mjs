import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMANDER_XP_PER_LEVEL,
  COMMAND_CENTER_GATES,
  DIFFICULTY,
  ENEMY_CLASS,
  FACILITY,
  FACILITY_META,
  FACILITY_ORDER,
  RARITY,
  SKILL_NODES,
  commanderLevelForXp
} from '../js/config/index.js';
import { createInitialState, createRun, PHASE, sanitizeState } from '../js/core/state.js';
import {
  addRunXp,
  previewSettlementXp,
  settleCommanderXp
} from '../js/systems/commander.js';
import { advance } from '../js/systems/march.js';
import { addToCarry, LOOT_KIND } from '../js/systems/loot.js';

const MAX_COMMANDER_XP = COMMANDER_XP_PER_LEVEL.reduce((sum, xp) => sum + xp, 0);

function stateWithRun({ difficulty = DIFFICULTY.NORMAL, commanderXp = 0, bagCapacity = 20 } = {}) {
  const s = createInitialState();
  s.run = createRun({
    mapId: 'dam', difficulty, timeLimit: 120,
    startedAt: 1000, squadSnapshot: [{ id: 'op_1', name: '测试干员', hp: 100, atk: 10 }],
    loadoutSnapshot: {}, maxHp: 100, nodeGap: 3, bagCapacity, commanderXp
  });
  return s;
}

test('defines seven immutable facilities in the progression order', () => {
  assert.deepEqual(FACILITY_ORDER, [
    FACILITY.COMMAND_CENTER,
    FACILITY.ARMORY,
    FACILITY.ARMOR,
    FACILITY.STORAGE,
    FACILITY.INTELLIGENCE,
    FACILITY.MEDICAL,
    FACILITY.MOBILITY
  ]);
  assert.equal(FACILITY_ORDER.length, 7);
  assert.equal(new Set(FACILITY_ORDER).size, 7);
  assert.ok(Object.isFrozen(FACILITY));

  FACILITY_ORDER.forEach((id) => {
    assert.equal(FACILITY_META[id].id, id);
    assert.ok(Object.isFrozen(FACILITY_META[id]));
  });
});

test('uses the exact 29-level commander XP curve and command-center gates', () => {
  assert.deepEqual(COMMANDER_XP_PER_LEVEL, [
    500, 500, 500, 500,
    1200, 1200, 1200, 1200, 1200,
    2500, 2500, 2500, 2500, 2500,
    5000, 5000, 5000, 5000, 5000,
    9000, 9000, 9000, 9000, 9000,
    15000, 15000, 15000, 15000, 15000
  ]);
  assert.deepEqual(COMMAND_CENTER_GATES, [1, 3, 6, 9, 12, 15, 18, 21, 25, 30]);
  assert.ok(Object.isFrozen(COMMANDER_XP_PER_LEVEL));
  assert.ok(Object.isFrozen(COMMAND_CENTER_GATES));
});

test('derives commander level from normalized total XP and caps at level 30', () => {
  assert.equal(commanderLevelForXp(-100), 1);
  assert.equal(commanderLevelForXp('499.9'), 1);
  assert.equal(commanderLevelForXp('500.9'), 2);
  assert.equal(commanderLevelForXp(4 * 500), 5);
  assert.equal(commanderLevelForXp(4 * 500 + 5 * 1200), 10);
  assert.equal(commanderLevelForXp(COMMANDER_XP_PER_LEVEL.reduce((sum, xp) => sum + xp, 0)), 30);
  assert.equal(commanderLevelForXp(Number.POSITIVE_INFINITY), 30);
});

test('fresh state starts with neutral commander, facilities, and run snapshots', () => {
  const state = createInitialState();
  const run = createRun({
    mapId: 'dam', difficulty: 'normal', timeLimit: 120,
    startedAt: 1000, squadSnapshot: [], loadoutSnapshot: {},
    maxHp: 100, nodeGap: 3
  });

  assert.deepEqual(state.commander, { level: 1, totalXp: 0, currentXp: 0 });
  assert.deepEqual(state.base.facilities, {
    commandCenter: 1,
    armory: 1,
    armor: 1,
    storage: 1,
    intelligence: 1,
    medical: 1,
    mobility: 1
  });
  assert.deepEqual(state.base.loadoutPresets, []);
  assert.equal(run.commanderXp, 0);
  assert.deepEqual(run.baseBonuses, {});
  assert.deepEqual(run.medical, { maxUses: 0, remainingUses: 0, healRatio: 0 });
  assert.deepEqual(run.mobility, { remainingSkips: 0, startPreviewNodes: 0 });
});

test('old save gets neutral base without losing data', () => {
  const old = createInitialState();
  delete old.commander;
  delete old.base;
  const next = sanitizeState(old);

  assert.equal(next.commander.level, 1);
  assert.deepEqual(Object.values(next.base.facilities), Array(7).fill(1));
  assert.deepEqual(next.inventory, old.inventory);
  assert.deepEqual(next.gallery, old.gallery);
  assert.deepEqual(next.operators, old.operators);
  assert.deepEqual(next.skills, old.skills);
  assert.deepEqual(next.stats, old.stats);
});

test('old save preserves maxed skills and equipped tier-five/six gear below new shop gates', () => {
  const old = createInitialState();
  delete old.commander;
  delete old.base;
  delete old.loadouts;
  old.inventory = [
    { uid: 'legacy-w6', tplId: 'w_rail', slot: 'weapon' },
    { uid: 'legacy-a5', tplId: 'a_t5', slot: 'armor' },
    { uid: 'legacy-h6', tplId: 'h_t6', slot: 'helmet' },
    { uid: 'legacy-b5', tplId: 'b_t5', slot: 'bag' }
  ];
  old.operators = {
    unlocked: ['op_weilong'],
    levels: { op_weilong: 8 },
    squad: ['op_weilong']
  };
  old.loadout = {
    weapon: 'legacy-w6',
    armor: 'legacy-a5',
    helmet: 'legacy-h6',
    bag: 'legacy-b5',
    tactical: null
  };
  old.skills = Object.fromEntries(SKILL_NODES.map((node) => [node.id, node.maxLevel]));

  const next = sanitizeState(old);

  assert.deepEqual(Object.values(next.base.facilities), Array(7).fill(1));
  assert.deepEqual(next.skills, old.skills);
  assert.deepEqual(next.inventory.map(({ uid, tplId, slot }) => ({ uid, tplId, slot })), old.inventory);
  assert.deepEqual(next.loadouts.op_weilong, old.loadout);
});

test('save migration preserves partial presets, missing references, and equipped legacy gear', () => {
  const old = createInitialState();
  old.base.facilities[FACILITY.COMMAND_CENTER] = 3;
  old.inventory = [
    { uid: 'legacy-helmet', tplId: 'removed_legacy_helmet', slot: 'helmet' }
  ];
  old.operators = {
    unlocked: ['op_weilong'],
    levels: { op_weilong: 1 },
    squad: ['op_weilong']
  };
  old.loadouts = {
    op_weilong: { weapon: null, armor: null, helmet: 'legacy-helmet', bag: null, tactical: null }
  };
  old.base.loadoutPresets = [{
    loadouts: {
      op_weilong: { weapon: 'missing-preset-weapon', helmet: 'legacy-helmet' }
    }
  }];

  const next = sanitizeState(old);

  assert.equal(next.loadouts.op_weilong.helmet, 'legacy-helmet');
  assert.deepEqual(next.base.loadoutPresets, [{
    loadouts: {
      op_weilong: { weapon: 'missing-preset-weapon', helmet: 'legacy-helmet' }
    }
  }]);
});

test('sanitization caps corrupt progression values and derives commander level from total XP', () => {
  const state = createInitialState();
  state.commander = { level: 1, totalXp: Number.POSITIVE_INFINITY, currentXp: -1 };
  state.base = {
    facilities: {
      commandCenter: 0,
      armory: 11,
      armor: '8.9',
      storage: 4.5,
      intelligence: -7,
      medical: null,
      mobility: Number.POSITIVE_INFINITY
    }
  };

  const next = sanitizeState(state);

  assert.deepEqual(next.commander, { level: 30, totalXp: 165500, currentXp: 0 });
  assert.deepEqual(next.base.facilities, {
    commandCenter: 1,
    armory: 10,
    armor: 8,
    storage: 4,
    intelligence: 1,
    medical: 1,
    mobility: 10
  });
});

test('active legacy runs receive neutral base snapshots without being rejected', () => {
  const old = createInitialState();
  old.run = createRun({
    mapId: 'dam', difficulty: 'normal', timeLimit: 120,
    startedAt: 1000, squadSnapshot: [], loadoutSnapshot: {},
    maxHp: 100, nodeGap: 3
  });
  old.run.carry.hafCoin = 45;
  delete old.run.commanderXp;
  delete old.run.baseBonuses;
  delete old.run.medical;
  delete old.run.mobility;
  delete old.commander;
  delete old.base;

  const next = sanitizeState(old);

  assert.equal(next.run.mapId, 'dam');
  assert.equal(next.run.carry.hafCoin, 45);
  assert.equal(next.run.commanderXp, 0);
  assert.equal(next.run.commanderXpSettled, false);
  assert.deepEqual(next.run.baseBonuses, {});
  assert.deepEqual(next.run.medical, { maxUses: 0, remainingUses: 0, healRatio: 0 });
  assert.deepEqual(next.run.mobility, { remainingSkips: 0, startPreviewNodes: 0 });
});

test('successful settlement previews exact difficulty XP', () => {
  const expected = new Map([
    [DIFFICULTY.NORMAL, { xp: 100, level: 1 }],
    [DIFFICULTY.SECRET, { xp: 250, level: 1 }],
    [DIFFICULTY.TOP_SECRET, { xp: 600, level: 2 }],
    [DIFFICULTY.ETERNAL, { xp: 1200, level: 3 }]
  ]);

  expected.forEach(({ xp, level }, difficulty) => {
    const result = previewSettlementXp(true, stateWithRun({ difficulty }));
    assert.deepEqual(result, {
      earned: xp,
      applied: xp,
      beforeLevel: 1,
      afterLevel: level,
      totalXp: xp
    });
  });
});

test('confirmed kill path awards exact XP for each enemy class', () => {
  const expected = new Map([
    [ENEMY_CLASS.NORMAL, 2],
    [ENEMY_CLASS.ELITE, 10],
    [ENEMY_CLASS.OPERATOR, 20],
    [ENEMY_CLASS.BOSS, 50]
  ]);

  expected.forEach((xp, enemyClass) => {
    const s = stateWithRun({ bagCapacity: 0 });
    const now = 10_000;
    s.run.phase = PHASE.COMBAT;
    s.run.node = {
      kind: enemyClass === ENEMY_CLASS.BOSS ? 'boss' : 'enemy',
      enemyClass,
      interval: 0.1,
      lastTickAt: now - 1000,
      enemy: {
        cls: enemyClass,
        name: '测试目标',
        hp: 0,
        maxHp: 100,
        atk: 1,
        def: 0,
        lootTier: RARITY.COMMON,
        carried: [],
        skills: [],
        isBoss: enemyClass === ENEMY_CLASS.BOSS
      }
    };

    advance(s, now);

    assert.equal(s.run.commanderXp, xp);
  });
});

test('gold and red loot award XP only after capacity accepts them', () => {
  const s = stateWithRun({ bagCapacity: 2 });
  const gold = {
    uid: 'gold_accepted', kind: LOOT_KIND.COLLECTIBLE, tplId: 'gold',
    name: '金色物品', rarity: RARITY.LEGEND, count: 1, value: 100
  };
  const red = {
    uid: 'red_accepted', kind: LOOT_KIND.COLLECTIBLE, tplId: 'red',
    name: '红色物品', rarity: RARITY.RED, count: 1, value: 200
  };
  const rejected = {
    uid: 'red_rejected', kind: LOOT_KIND.COLLECTIBLE, tplId: 'red_2',
    name: '未装入红色物品', rarity: RARITY.RED, count: 1, value: 200
  };

  addToCarry([gold, red, rejected], s);

  assert.deepEqual(s.run.carry.lastAccepted.map((item) => item.uid), ['gold_accepted', 'red_accepted']);
  assert.deepEqual(s.run.carry.lastRejected.map((item) => item.uid), ['red_rejected']);
  assert.equal(s.run.commanderXp, 120);
});

test('failed settlement keeps a floored 30 percent and settles only once', () => {
  const s = stateWithRun();
  addRunXp('kill', 19, s);

  assert.deepEqual(previewSettlementXp(false, s), {
    earned: 5,
    applied: 5,
    beforeLevel: 1,
    afterLevel: 1,
    totalXp: 5
  });

  const first = settleCommanderXp(false, s);
  const second = settleCommanderXp(false, s);

  assert.equal(first.applied, 5);
  assert.equal(second.applied, 0);
  assert.equal(s.commander.totalXp, 5);
  assert.equal(s.run.commanderXpSettled, true);
});

test('settlement applies only XP remaining below the level-30 cap', () => {
  const s = stateWithRun({ commanderXp: 200 });
  s.commander.totalXp = MAX_COMMANDER_XP - 50;
  s.commander.level = 29;
  s.commander.currentXp = 14_950;

  const result = settleCommanderXp(true, s);

  assert.deepEqual(result, {
    earned: 300,
    applied: 50,
    beforeLevel: 29,
    afterLevel: 30,
    totalXp: MAX_COMMANDER_XP
  });
  assert.deepEqual(s.commander, { level: 30, totalXp: MAX_COMMANDER_XP, currentXp: 0 });
});

test('level 30 still records exact run earnings while applying zero XP', () => {
  const s = stateWithRun({ bagCapacity: 1 });
  s.commander = { level: 30, totalXp: MAX_COMMANDER_XP, currentXp: 0 };
  const acceptedGold = {
    uid: 'gold_at_cap', kind: LOOT_KIND.COLLECTIBLE, tplId: 'gold_at_cap',
    name: '满级金色物品', rarity: RARITY.LEGEND, count: 1, value: 100
  };
  const rejectedGold = {
    uid: 'gold_rejected_at_cap', kind: LOOT_KIND.COLLECTIBLE, tplId: 'gold_rejected_at_cap',
    name: '未装入金色物品', rarity: RARITY.LEGEND, count: 1, value: 100
  };

  addRunXp('kill', 2, s);
  addToCarry([acceptedGold, rejectedGold], s);

  assert.deepEqual(s.run.carry.lastAccepted.map((item) => item.uid), ['gold_at_cap']);
  assert.deepEqual(s.run.carry.lastRejected.map((item) => item.uid), ['gold_rejected_at_cap']);
  assert.equal(s.run.commanderXp, 22);

  const expected = {
    earned: 122,
    applied: 0,
    beforeLevel: 30,
    afterLevel: 30,
    totalXp: MAX_COMMANDER_XP
  };
  assert.deepEqual(previewSettlementXp(true, s), expected);
  assert.deepEqual(settleCommanderXp(true, s), expected);
  assert.deepEqual(s.commander, { level: 30, totalXp: MAX_COMMANDER_XP, currentXp: 0 });
});
