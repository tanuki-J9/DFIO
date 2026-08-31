import test from 'node:test';
import assert from 'node:assert/strict';

import { MAPS, DIFFICULTY_META } from '../js/config/index.js';
import { createInitialState, createRun, PHASE } from '../js/core/state.js';
import { renderHeader } from '../js/ui/explore/panel.js';
import * as stage from '../js/ui/explore/stage.js';

function actionState() {
  const s = createInitialState();
  const map = MAPS[0];
  const difficulty = Object.keys(DIFFICULTY_META)[0];
  s.selection = { mapId: map.id, difficulty };
  s.run = createRun({
    mapId: map.id,
    difficulty,
    timeLimit: 300,
    startedAt: 1_000,
    squadSnapshot: [
      { id: 'op_a', name: '纪玖', role: 'assault', hp: 100 },
      { id: 'op_b', name: '医疗兵', role: 'support', hp: 100 }
    ],
    loadoutSnapshot: {},
    maxHp: 200,
    nodeGap: 3
  });
  return s;
}

test('header no longer renders aggregate or member squad health cards', () => {
  const html = renderHeader(actionState(), 2_000);

  assert.doesNotMatch(html, /小队生命/);
  assert.doesNotMatch(html, /纪玖/);
  assert.doesNotMatch(html, /医疗兵/);
});

test('actor markup places the member name and health bar above the sprite', () => {
  assert.equal(typeof stage.actorMarkup, 'function');
  if (typeof stage.actorMarkup !== 'function') return;

  const html = stage.actorMarkup(
    { id: 'op_a', name: '纪玖', role: 'assault' },
    { id: 'op_a', name: '纪玖', hp: 72, maxHp: 100, downed: false },
    'fight'
  );

  assert.match(html, /class="squad-actor"/);
  assert.match(html, /class="squad-name"[^>]*>纪玖</);
  assert.match(html, /class="squad-hp-fill[^"]*" style="width:72\.0%"/);
  assert.match(html, /data-act="fight"/);
});

test('downed actor nameplate shows downed state with empty health', () => {
  assert.equal(typeof stage.actorMarkup, 'function');
  if (typeof stage.actorMarkup !== 'function') return;

  const html = stage.actorMarkup(
    { id: 'op_b', name: '医疗兵', role: 'support' },
    { id: 'op_b', name: '医疗兵', hp: 0, maxHp: 100, downed: true },
    'walk'
  );

  assert.match(html, /squad-actor is-downed/);
  assert.match(html, />医疗兵 · 倒地</);
  assert.match(html, /style="width:0\.0%"/);
  assert.match(html, /data-act="down"/);
});

test('health tone changes as current health crosses warning thresholds', () => {
  assert.equal(typeof stage.healthTone, 'function');
  if (typeof stage.healthTone !== 'function') return;

  assert.equal(stage.healthTone(0.8, false), 'healthy');
  assert.equal(stage.healthTone(0.5, false), 'warning');
  assert.equal(stage.healthTone(0.25, false), 'critical');
  assert.equal(stage.healthTone(1, true), 'critical');
});

test('loot reveal timing increases with rarity', () => {
  assert.equal(typeof stage.lootRevealAt, 'function');
  if (typeof stage.lootRevealAt !== 'function') return;

  const points = ['common', 'rare', 'epic', 'legend', 'red'].map(stage.lootRevealAt);
  for (let i = 1; i < points.length; i += 1) {
    assert.ok(points[i] > points[i - 1], `${points[i]} must exceed ${points[i - 1]}`);
  }
  assert.ok(points.at(-1) < 1);
});

test('loot slots search together and reveal only after their rarity threshold', () => {
  assert.equal(typeof stage.lootSearchMarkup, 'function');
  if (typeof stage.lootSearchMarkup !== 'function') return;

  const loot = [
    { uid: 'a', kind: 'material', name: '普通零件', rarity: 'common', count: 1 },
    { uid: 'b', kind: 'equipment', name: '红色机密', rarity: 'red', count: 1 }
  ];
  const html = stage.lootSearchMarkup(loot, 0.55);

  assert.match(html, /data-loot-uid="a"[^>]*data-revealed="1"/);
  assert.match(html, /普通零件/);
  assert.match(html, /data-loot-uid="b"[^>]*data-revealed="0"/);
  assert.match(html, /loot-magnifier/);
  assert.doesNotMatch(html, /红色机密/);
});

test('stage medical text renders automatic heal feedback and remaining snapshotted uses', () => {
  assert.equal(typeof stage.medicalUsesText, 'function');
  assert.equal(typeof stage.medicalFxText, 'function');
  if (typeof stage.medicalUsesText !== 'function' || typeof stage.medicalFxText !== 'function') return;

  assert.equal(stage.medicalUsesText({ medical: { maxUses: 4, remainingUses: 2 } }), '急救包 2/4');
  assert.equal(stage.medicalUsesText({ medical: { maxUses: 0, remainingUses: 0 } }), '');
  assert.equal(stage.medicalFxText({ amount: 27, maxUses: 4, remainingUses: 2 }),
    '急救 +27 · 剩余 2/4');
});
