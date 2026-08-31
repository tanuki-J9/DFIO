import test from 'node:test';
import assert from 'node:assert/strict';

import { FACILITY, SKILL_NODES } from '../js/config/index.js';
import { createInitialState } from '../js/core/state.js';

class FakeClassList {
  constructor(...names) { this.names = new Set(names); }
  add(...names) { names.forEach((name) => this.names.add(name)); }
  remove(...names) { names.forEach((name) => this.names.delete(name)); }
  contains(name) { return this.names.has(name); }
  toggle(name, force) {
    if (force === true) this.names.add(name);
    else if (force === false) this.names.delete(name);
    else if (this.names.has(name)) this.names.delete(name);
    else this.names.add(name);
  }
}

class FakeElement {
  constructor({ hidden = false } = {}) {
    this.classList = new FakeClassList('view', ...(hidden ? ['hidden'] : []));
    this.dataset = {};
    this.innerHTML = '';
    this.textContent = '';
    this.style = {};
    this.handlers = {};
    this.offsetWidth = 0;
  }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  appendChild() {}
  contains() { return true; }
  querySelector() { return null; }
  remove() {}
}

function launchReadySave() {
  const s = createInitialState();
  s.commander.totalXp = 165_500;
  Object.values(FACILITY).forEach((id) => { s.base.facilities[id] = 10; });
  s.inventory = [
    { uid: 'launch-w', tplId: 'w_rail', slot: 'weapon' },
    { uid: 'launch-a', tplId: 'a_t6', slot: 'armor' },
    { uid: 'launch-h', tplId: 'h_t6', slot: 'helmet' },
    { uid: 'launch-b', tplId: 'b_t6', slot: 'bag' },
    { uid: 'launch-med', tplId: 't_med', slot: 'tactical' }
  ];
  s.operators = {
    unlocked: ['op_weilong'],
    levels: { op_weilong: 10 },
    squad: ['op_weilong']
  };
  s.loadouts = {
    op_weilong: {
      weapon: 'launch-w', armor: 'launch-a', helmet: 'launch-h',
      bag: 'launch-b', tactical: 'launch-med'
    }
  };
  s.skills = Object.fromEntries(SKILL_NODES.map((node) => [node.id, node.maxLevel]));
  s.selection = { mapId: 'dam', difficulty: 'normal' };
  return s;
}

test('main launch click snapshots base, medical, mobility, and loadout state into a new run', async () => {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval
  };
  const elements = {
    'topbar-root': new FakeElement(),
    'topbar-info': new FakeElement(),
    'view-prepare': new FakeElement(),
    'view-explore': new FakeElement({ hidden: true }),
    'modal-root': new FakeElement(),
    'toast-root': new FakeElement()
  };
  const exploreSections = Object.fromEntries(
    ['#ex-header', '#ex-stage-wrap', '#ex-stats', '#ex-carry', '#ex-log']
      .map((selector) => [selector, new FakeElement()])
  );
  elements['view-explore'].querySelector = (selector) => exploreSections[selector] || null;
  const documentHandlers = {};
  const seed = JSON.stringify({ version: 1, savedAt: Date.now(), data: launchReadySave() });
  let saved = seed;

  globalThis.localStorage = {
    getItem: (key) => key === 'delta_idle_save_v1' ? saved : null,
    setItem: (key, value) => { if (key === 'delta_idle_save_v1') saved = value; },
    removeItem: () => {}
  };
  globalThis.document = {
    readyState: 'loading',
    visibilityState: 'visible',
    getElementById: (id) => elements[id] || null,
    createElement: () => new FakeElement(),
    addEventListener(type, handler) { (documentHandlers[type] ||= []).push(handler); },
    removeEventListener: () => {}
  };
  globalThis.window = { addEventListener: () => {} };
  globalThis.requestAnimationFrame = (callback) => { callback(0); return 1; };
  globalThis.setTimeout = () => 1;
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};

  try {
    await import(`../js/main.js?task12=${Date.now()}`);
    assert.equal(documentHandlers.DOMContentLoaded?.length, 1);
    documentHandlers.DOMContentLoaded[0]();

    const click = elements['view-prepare'].handlers.click;
    assert.equal(typeof click, 'function');
    const target = {
      dataset: { action: 'launch' },
      closest: (selector) => selector === '[data-action]' ? target : null
    };
    click({ target, preventDefault: () => {} });

    const persisted = JSON.parse(saved).data;
    assert.equal(persisted.view, 'explore');
    assert.equal(persisted.run.mapId, 'dam');
    assert.equal(persisted.run.difficulty, 'normal');
    assert.equal(persisted.run.bagCapacity, 24);
    assert.equal(persisted.run.baseBonuses.scavengeSpeed, 0.3);
    assert.equal(persisted.run.baseBonuses.redWeightBonus, 0.25);
    assert.equal(persisted.run.baseBonuses.medicalHpPct, 0.2);
    assert.equal(persisted.run.baseBonuses.medicalReviveSpeed, 0.4);
    assert.deepEqual(persisted.run.medical, {
      maxUses: 4, remainingUses: 4, healRatio: 0.27
    });
    assert.deepEqual(persisted.run.mobility, {
      remainingSkips: 2, startPreviewNodes: 1
    });
    assert.equal(persisted.run.loadoutSnapshot.op_weilong.weapon, 'launch-w');
    assert.equal(elements['view-prepare'].classList.contains('hidden'), true);
    assert.equal(elements['view-explore'].classList.contains('hidden'), false);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
