import test from 'node:test';
import assert from 'node:assert/strict';

import * as march from '../js/systems/march.js';
import { MAPS, DIFFICULTY_META } from '../js/config/index.js';
import { createInitialState, createRun, setState } from '../js/core/state.js';

test('crate completion reuses pending loot without rolling a second time', () => {
  assert.equal(typeof march.resolveCrateLoot, 'function');
  if (typeof march.resolveCrateLoot !== 'function') return;

  const pending = [{ uid: 'fixed', name: '已搜索物品', rarity: 'epic' }];
  let rolls = 0;
  const result = march.resolveCrateLoot({ pendingLoot: pending }, () => {
    rolls += 1;
    return [{ uid: 'rerolled' }];
  });

  assert.deepEqual(result, pending);
  assert.equal(rolls, 0);
});

test('legacy crate nodes without pending loot still roll safely', () => {
  assert.equal(typeof march.resolveCrateLoot, 'function');
  if (typeof march.resolveCrateLoot !== 'function') return;

  const fallback = [{ uid: 'fallback', name: '兼容旧存档', rarity: 'common' }];
  let rolls = 0;
  const result = march.resolveCrateLoot({}, () => {
    rolls += 1;
    return fallback;
  });

  assert.deepEqual(result, fallback);
  assert.equal(rolls, 1);
});

test('crate flow pre-rolls loot, keeps it out of carry, then settles that exact loot once', () => {
  assert.equal(typeof march.enterCrate, 'function');
  assert.equal(typeof march.finishCrate, 'function');
  if (typeof march.enterCrate !== 'function' || typeof march.finishCrate !== 'function') return;

  const s = createInitialState();
  const map = MAPS[0];
  const difficulty = Object.keys(DIFFICULTY_META)[0];
  s.run = createRun({
    mapId: map.id,
    difficulty,
    timeLimit: 300,
    startedAt: 1_000,
    squadSnapshot: [],
    loadoutSnapshot: {},
    maxHp: 100,
    nodeGap: 3
  });
  setState(s);
  const branch = march.currentBranch(s);

  march.enterCrate(s, branch, 2_000);
  const pending = s.run.node.pendingLoot.map((item) => item.uid);
  assert.ok(pending.length > 0);
  assert.equal(s.run.carry.items.length, 0);

  march.finishCrate(s, 5_000);
  assert.deepEqual(s.run.carry.lastAccepted.map((item) => item.uid), pending);
  const countAfterFinish = s.run.carry.items.length;

  march.finishCrate(s, 5_100);
  assert.equal(s.run.carry.items.length, countAfterFinish);
});
