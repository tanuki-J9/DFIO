import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  DIFFICULTY,
  EQUIPMENT_TEMPLATES,
  ENEMY_VARIANTS,
  getTemplate
} from '../js/config/index.js';
import {
  checkThreshold,
  squadBagCapacity
} from '../js/systems/readiness.js';
import { addToCarry, LOOT_KIND } from '../js/systems/loot.js';
import { createInitialState, createRun, sanitizeState } from '../js/core/state.js';

function gearedState(levels) {
  const inventory = [];
  const loadouts = {};
  const squad = levels.map((level, index) => {
    const opId = `op_${index}`;
    loadouts[opId] = {};
    for (const slot of ['weapon', 'armor', 'helmet', 'bag']) {
      const tpl = EQUIPMENT_TEMPLATES.find((item) => item.slot === slot && item.level === level);
      assert.ok(tpl, `missing level ${level} ${slot}`);
      const uid = `${opId}_${slot}`;
      inventory.push({ uid, tplId: tpl.id, slot });
      loadouts[opId][slot] = uid;
    }
    return opId;
  });
  return { inventory, loadouts, operators: { squad } };
}

test('mission access uses original value threshold multiplied by squad size', () => {
  const secret = checkThreshold('dam', DIFFICULTY.SECRET, gearedState([3, 3, 3]));
  assert.equal(secret.base, 112500);
  assert.equal(secret.required, 337500);
  assert.equal(secret.ok, true);

  const expensiveSecret = checkThreshold('bakesh', DIFFICULTY.SECRET, gearedState([3, 3, 3]));
  assert.equal(expensiveSecret.required, 562500);
  assert.equal(expensiveSecret.ok, false);

  const eternal = checkThreshold('space', DIFFICULTY.ETERNAL, gearedState([5, 5, 5]));
  assert.equal(eternal.required, 3000000);
  assert.equal(eternal.ok, true);
});

test('equipment economy aligns full sets with original thresholds', () => {
  const setValue = (level) => ['weapon', 'armor', 'helmet', 'bag'].reduce((sum, slot) => {
    const items = EQUIPMENT_TEMPLATES.filter((item) => item.slot === slot && item.level === level);
    return sum + Math.round(items.reduce((n, item) => n + item.value, 0) / items.length);
  }, 0);
  assert.ok(setValue(3) >= 112500 && setValue(3) < 187500);
  assert.ok(setValue(4) >= 600000 && setValue(4) < 780000);
  assert.ok(setValue(5) >= 1000000);
  EQUIPMENT_TEMPLATES.forEach((item) => assert.ok(item.price > item.value));
});

test('every backpack level exists and squad capacity stacks', () => {
  const bags = EQUIPMENT_TEMPLATES.filter((item) => item.slot === 'bag');
  assert.deepEqual([...new Set(bags.map((item) => item.level))].sort(), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(bags.sort((a, b) => a.level - b.level).map((item) => item.capacity), [6, 9, 12, 16, 20, 24]);
  assert.equal(squadBagCapacity(gearedState([3, 4, 5])), 48);
});

test('each weapon level offers at least three real weapon choices', () => {
  for (let level = 1; level <= 6; level += 1) {
    const weapons = EQUIPMENT_TEMPLATES.filter((item) => item.slot === 'weapon' && item.level === level);
    assert.ok(weapons.length >= 3, `level ${level} only has ${weapons.length} weapons`);
    weapons.forEach((weapon) => {
      assert.ok(weapon.atk > 0);
      assert.ok(weapon.price >= weapon.value);
      assert.ok(getTemplate(weapon.id));
    });
  }
});

test('secret and higher enemies have multiple stat profiles', () => {
  for (const tier of [2, 3, 4, 5]) {
    assert.ok(ENEMY_VARIANTS[tier].length >= 3);
    assert.ok(new Set(ENEMY_VARIANTS[tier].map((v) => `${v.atkMul}/${v.hpMul}/${v.defMul}`)).size >= 3);
  }
});

test('loot respects stacked squad backpack capacity', () => {
  const state = gearedState([3]);
  const bag = state.inventory.find((item) => item.slot === 'bag');
  bag.tplId = 'b_s';
  state.run = { bagCapacity: 6, carry: { hafCoin: 0, items: [] } };
  const loot = Array.from({ length: 7 }, (_, index) => ({
    uid: `loot_${index}`,
    kind: LOOT_KIND.EQUIPMENT,
    tplId: 'w_car15',
    name: 'CAR-15 突击步枪',
    rarity: 'common',
    count: 1,
    value: 100
  }));
  const gained = addToCarry(loot, state);
  assert.equal(state.run.carry.items.length, 6);
  assert.equal(state.run.carry.capacity, 6);
  assert.equal(state.run.carry.overflow, 1);
  assert.equal(state.run.carry.lastAccepted.length, 6);
  assert.equal(state.run.carry.lastRejected.length, 1);
  assert.equal(gained, 600);
});

test('prepare UI explains gear thresholds and backpack capacity', async () => {
  const mapPanel = await readFile(new URL('../js/ui/prepare/mapPanel.js', import.meta.url), 'utf8');
  const prepare = await readFile(new URL('../js/ui/prepare/index.js', import.meta.url), 'utf8');
  const explore = await readFile(new URL('../js/ui/explore/panel.js', import.meta.url), 'utf8');
  assert.match(mapPanel, /准入价值/);
  assert.doesNotMatch(mapPanel, /套装等级不足/);
  assert.match(prepare, /背包容量/);
  assert.match(prepare, /战备价值不足/);
  assert.match(explore, /背包.*容量|容量.*背包/);
});

test('reload preserves new run capacity and marks legacy runs as unlimited', () => {
  const state = createInitialState();
  state.run = createRun({
    mapId: 'dam', difficulty: DIFFICULTY.SECRET, timeLimit: 120,
    startedAt: Date.now(), squadSnapshot: [], loadoutSnapshot: {},
    maxHp: 100, nodeGap: 3, bagCapacity: 36
  });
  assert.equal(sanitizeState(state).run.bagCapacity, 36);

  delete state.run.bagCapacity;
  assert.equal(sanitizeState(state).run.bagCapacity, null);

  const legacy = gearedState([3]);
  legacy.run = { bagCapacity: null, carry: { hafCoin: 0, items: [] } };
  const legacyLoot = Array.from({ length: 13 }, (_, index) => ({
    uid: `legacy_${index}`, kind: LOOT_KIND.EQUIPMENT, tplId: 'w_car15',
    name: 'CAR-15 突击步枪', rarity: 'common', count: 1, value: 100
  }));
  addToCarry(legacyLoot, legacy);
  assert.equal(legacy.run.carry.items.length, 13);
});
