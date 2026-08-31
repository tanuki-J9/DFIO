import test from 'node:test';
import assert from 'node:assert/strict';

import { FACILITY, FACILITY_ORDER, SKILL_NODES } from '../js/config/index.js';
import { createInitialState, getState, setState } from '../js/core/state.js';
import * as skillSystem from '../js/systems/skill.js';
import {
  handleFacilityUpgrade,
  openFacilityDetail,
  renderBasePanel,
  renderFacilityDetail
} from '../js/ui/prepare/basePanel.js';
import { renderGalleryPanel, setGallerySeries } from '../js/ui/prepare/galleryPanel.js';
import { renderWarehousePanel, setWarehouseCat } from '../js/ui/prepare/warehousePanel.js';
import { renderTopbarInfo } from '../js/ui/topbar.js';
import { renderPrepare } from '../js/ui/prepare/index.js';

function levelNineArmoryState() {
  const s = createInitialState();
  s.commander = { level: 30, totalXp: 165_500, currentXp: 0 };
  s.base.facilities.commandCenter = 9;
  s.base.facilities.armory = 8;
  s.currency.hafCoin = 20_000_000;
  s.materials = { m_pe: 3 };
  s.collectibles = { c_judgement: 3, c_gpu: 2 };
  s.gallery.c_gpu = { at: 1234, count: 2 };
  return s;
}

const ARMORY_NINE_PICKS = {
  poolPicks: [
    { tplId: 'm_pe', count: 3 },
    { tplId: 'c_judgement', count: 3 }
  ]
};

test('every legacy skill ID maps to exactly one intended facility', () => {
  assert.equal(typeof skillSystem.skillNodesForFacility, 'function');
  if (typeof skillSystem.skillNodesForFacility !== 'function') return;
  const s = createInitialState();
  const actual = Object.fromEntries(FACILITY_ORDER.map((facilityId) => [
    facilityId,
    skillSystem.skillNodesForFacility(facilityId, s).map((node) => node.id)
  ]));

  assert.deepEqual(actual, {
    commandCenter: [],
    armory: ['sk_atk', 'sk_rate', 'sk_boss'],
    armor: ['sk_def'],
    storage: ['sk_ext', 'sk_time', 'sk_box'],
    intelligence: ['sk_speed', 'sk_loot', 'sk_tier'],
    medical: ['sk_hp', 'sk_regen'],
    mobility: []
  });

  const mappedIds = Object.values(actual).flat();
  assert.equal(new Set(mappedIds).size, mappedIds.length);
  assert.deepEqual(mappedIds.toSorted(), SKILL_NODES.map((node) => node.id).toSorted());
});

test('a maxed facility still renders its saved permanent skill levels and costs', () => {
  const s = createInitialState();
  s.base.facilities[FACILITY.ARMORY] = 10;
  s.skills.sk_atk = 2;
  s.currency.hafCoin = 1_000;

  const html = renderFacilityDetail(FACILITY.ARMORY, { poolPicks: [] }, s);

  assert.match(html, /data-action="base-skill-up" data-id="sk_atk"/);
  assert.match(html, /Lv\.2\/10/);
  assert.match(html, /升级 · 780 哈夫币/);
  assert.equal((html.match(/data-action="base-skill-up"/g) || []).length, 3);
});

test('attack skill card shows the effective twenty-percent cap while preserving level and cost progression', () => {
  const s = createInitialState();
  s.base.facilities[FACILITY.ARMORY] = 10;
  s.skills.sk_atk = 5;
  s.currency.hafCoin = 10_000;

  const html = renderFacilityDetail(FACILITY.ARMORY, { poolPicks: [] }, s);
  const card = html.match(/<article data-skill-id="sk_atk"[\s\S]*?<\/article>/)?.[0] || '';

  assert.match(card, /Lv\.5\/10/);
  assert.match(card, /当前[\s\S]*?\+20\.0%/);
  assert.match(card, /下级[\s\S]*?\+20\.0%/);
  assert.match(card, /账号攻击加成上限 20% 已生效/);
  assert.match(card, /data-action="base-skill-up" data-id="sk_atk"/);
  assert.match(card, /升级 · 1,500 哈夫币/);
});

test('base overview renders commander progress and routes to all seven facilities', () => {
  const s = createInitialState();
  s.commander = { level: 4, totalXp: 1_700, currentXp: 200 };

  const html = renderBasePanel(s);

  assert.match(html, /指挥官等级/);
  assert.match(html, /Lv\.4/);
  assert.match(html, /200\s*\/\s*500/);
  assert.equal((html.match(/data-action="base-facility"/g) || []).length, 7);
  FACILITY_ORDER.forEach((id) => assert.match(html, new RegExp(`data-id="${id}"`)));
});

test('level-ten Command Center displays its max badge and Eternal Construction presentation', () => {
  const s = createInitialState();
  s.base.facilities[FACILITY.COMMAND_CENTER] = 10;

  const html = renderBasePanel(s);
  const detail = renderFacilityDetail(FACILITY.COMMAND_CENTER, { poolPicks: [] }, s);

  assert.match(html, /data-command-center-badge/);
  assert.match(html, /满级徽章/);
  assert.match(html, /永恒建设/);
  assert.match(detail, /满级徽章/);
  assert.match(detail, /永恒建设/);

  s.base.facilities[FACILITY.COMMAND_CENTER] = 9;
  assert.doesNotMatch(renderBasePanel(s), /data-command-center-badge/);
});

test('facility cards show current core effects and detail compares current to next effects', () => {
  const s = createInitialState();
  Object.assign(s.base.facilities, {
    commandCenter: 3,
    armory: 2,
    armor: 1,
    storage: 3,
    intelligence: 3,
    medical: 1,
    mobility: 2
  });

  const overview = renderBasePanel(s);
  assert.equal((overview.match(/data-facility-effects=/g) || []).length, 7);
  assert.match(overview, /配装预设 1 套/);
  assert.match(overview, /武器商店 -4%/);
  assert.match(overview, /防具商店 -2%/);
  assert.match(overview, /仓库 \+30 格/);
  assert.match(overview, /搜刮耗时 -9%/);
  assert.match(overview, /治疗量 \+5%/);
  assert.match(overview, /节点行进 \+5%/);

  const detail = renderFacilityDetail(FACILITY.MEDICAL, { poolPicks: [] }, s);
  assert.match(detail, /核心效果 · 当前 → 下级/);
  assert.match(detail, /治疗量[\s\S]*?\+5%[\s\S]*?\+10%/);
  assert.match(detail, /小队生命[\s\S]*?\+2%[\s\S]*?\+4%/);
  assert.match(detail, /普通救援速度[\s\S]*?\+4%[\s\S]*?\+8%/);
});

test('a pure Haf Coin shortage uses yellow rather than red treatment', () => {
  const s = levelNineArmoryState();
  s.currency.hafCoin = 5_000_000;

  const html = renderFacilityDetail(FACILITY.ARMORY, ARMORY_NINE_PICKS, s);

  assert.match(html, /data-cost-kind="currency" class="[^"]*border-amber-400/);
  assert.match(html, /data-upgrade-status="currency-missing"/);
  assert.match(html, /哈夫币不足/);
  const currencyRow = html.match(/data-cost-kind="currency" class="([^"]*)"/)?.[1] || '';
  assert.doesNotMatch(currencyRow, /rust/);
});

test('facility detail renders its ten-level route, missing resources, sources, and pool selectors', () => {
  const s = levelNineArmoryState();
  s.currency.hafCoin = 5_000_000;
  s.collectibles.c_gpu = 1;

  const html = renderFacilityDetail(FACILITY.ARMORY, ARMORY_NINE_PICKS, s);

  assert.equal((html.match(/data-route-level=/g) || []).length, 10);
  assert.match(html, /还缺\s*1,000,000/);
  assert.match(html, /显卡/);
  assert.match(html, /航天基地/);
  assert.match(html, /首件保护/);
  assert.match(html, /可消耗\s*0/);
  assert.match(html, /data-action="base-pool-dec"/);
  assert.match(html, /data-action="base-pool-inc"/);
  assert.match(html, /data-pool="0"/);
  assert.match(html, /disabled/);
});

test('facility detail exposes an insufficient flexible-pool inventory shortage without mutation', () => {
  const s = createInitialState();
  s.base.facilities.commandCenter = 2;
  s.currency.hafCoin = 25_000;
  s.materials = { m_can: 2 };
  const before = structuredClone(s);

  const html = renderFacilityDetail(FACILITY.ARMORY, { poolPicks: [] }, s);

  assert.match(html, /可选物资池 1[\s\S]*?还缺 1/);
  assert.match(html, /升级资源不足/);
  assert.doesNotMatch(html, /请精确选择升级物资/);
  assert.deepEqual(s, before);
});

test('facility detail explains all-map material sources and a gate lock', () => {
  const s = createInitialState();
  const html = renderFacilityDetail(FACILITY.ARMORY, { poolPicks: [] }, s);

  assert.match(html, /全战区行动/);
  assert.match(html, /装备配置商店/);
  assert.match(html, /指挥中心.*2/);
  assert.match(html, /升级条件未满足/);
});

test('level nine upgrade requires a separate permanent-red confirmation', async () => {
  const cancelled = levelNineArmoryState();
  const before = structuredClone(cancelled);
  const prompts = [];

  const result = await handleFacilityUpgrade(FACILITY.ARMORY, ARMORY_NINE_PICKS, {
    state: cancelled,
    confirm: async (options) => {
      prompts.push(options);
      return prompts.length === 1;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(result.stage, 'permanent-red');
  assert.equal(prompts.length, 2);
  assert.match(prompts[0].title, /升级军械台/);
  assert.match(prompts[1].title, /永久消耗大红/);
  assert.match(prompts[1].body, /显卡/);
  assert.deepEqual(cancelled, before);

  const accepted = levelNineArmoryState();
  const acceptedPrompts = [];
  const upgraded = await handleFacilityUpgrade(FACILITY.ARMORY, ARMORY_NINE_PICKS, {
    state: accepted,
    confirm: async (options) => {
      acceptedPrompts.push(options);
      return true;
    },
    toastResult: () => {}
  });
  assert.equal(upgraded.ok, true);
  assert.equal(acceptedPrompts.length, 2);
  assert.equal(accepted.base.facilities.armory, 9);
  assert.equal(accepted.collectibles.c_gpu, 1);
});

test('ordinary upgrades use only the standard confirmation', async () => {
  const s = createInitialState();
  s.base.facilities.commandCenter = 2;
  s.currency.hafCoin = 25_000;
  s.materials.m_can = 3;
  const prompts = [];

  const result = await handleFacilityUpgrade(FACILITY.ARMORY, {
    poolPicks: [{ tplId: 'm_can', count: 3 }]
  }, {
    state: s,
    confirm: async (options) => { prompts.push(options); return true; },
    toastResult: () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(prompts.length, 1);
  assert.equal(s.base.facilities.armory, 2);
});

test('level ten keeps the permanent-red confirmation boundary', async () => {
  const s = levelNineArmoryState();
  s.base.facilities.commandCenter = 10;
  s.base.facilities.armory = 9;
  s.materials = { m_pe: 2 };
  s.collectibles = { c_judgement: 4, c_gpu: 3 };
  const prompts = [];

  const result = await handleFacilityUpgrade(FACILITY.ARMORY, {
    poolPicks: [
      { tplId: 'm_pe', count: 2 },
      { tplId: 'c_judgement', count: 4 }
    ]
  }, {
    state: s,
    confirm: async (options) => { prompts.push(options); return true; },
    toastResult: () => {}
  });

  assert.equal(result.ok, true);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1].title, /永久消耗大红/);
  assert.equal(s.base.facilities.armory, 10);
  assert.equal(s.collectibles.c_gpu, 1);
});

test('prepare navigation renders the Base route as a Special Operations page', () => {
  const originalDocument = globalThis.document;
  const root = { classList: { contains: () => false }, innerHTML: '' };
  globalThis.document = { getElementById: (id) => id === 'view-prepare' ? root : null };
  const state = getState();
  const previousTab = state.activeTab;

  try {
    state.activeTab = 'base';
    renderPrepare();
    assert.match(root.innerHTML, /特勤处 · 基地/);
    assert.match(root.innerHTML, /SPECIAL OPERATIONS BASE/);
    assert.match(root.innerHTML, /返回战术沙盘/);

    state.activeTab = 'skill';
    renderPrepare();
    assert.match(root.innerHTML, /TACTICAL MAP/);
    assert.doesNotMatch(root.innerHTML, /特勤处 · 技能升级/);
  } finally {
    state.activeTab = previousTab;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('delegated facility skill click upgrades the legacy node and repaints its card', () => {
  const originalDocument = globalThis.document;
  const originalSetTimeout = globalThis.setTimeout;
  const previousState = getState();
  const s = createInitialState();
  s.currency.hafCoin = 1_000;
  let clickHandler = null;
  let createCount = 0;

  const body = {
    innerHTML: '',
    addEventListener(type, handler) {
      if (type === 'click') clickHandler = handler;
    },
    contains: () => true
  };
  const wrap = {
    className: '',
    innerHTML: '',
    addEventListener: () => {},
    remove: () => {},
    querySelector: (selector) => selector === '[data-role="body"]' ? body : null
  };
  const toastEl = {
    className: '',
    textContent: '',
    classList: { add: () => {} },
    remove: () => {}
  };

  globalThis.setTimeout = (callback) => { callback(); return 1; };
  globalThis.document = {
    getElementById(id) {
      if (id === 'modal-root' || id === 'toast-root') return { appendChild: () => {} };
      return null;
    },
    createElement() {
      createCount += 1;
      return createCount === 1 ? wrap : toastEl;
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  try {
    setState(s);
    openFacilityDetail(FACILITY.ARMORY);
    assert.equal(typeof clickHandler, 'function');

    const target = {
      dataset: { action: 'base-skill-up', id: 'sk_atk' },
      closest: (selector) => selector === '[data-action]' ? target : null
    };
    clickHandler({ target, preventDefault: () => {} });

    assert.equal(s.skills.sk_atk, 1);
    assert.equal(s.currency.hafCoin, 700);
    assert.match(body.innerHTML, /data-action="base-skill-up" data-id="sk_atk"/);
    assert.match(body.innerHTML, /Lv\.1\/10/);
    assert.match(body.innerHTML, /升级 · 540 哈夫币/);
  } finally {
    setState(previousState);
    globalThis.setTimeout = originalSetTimeout;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('topbar, gallery, and warehouse expose commander and protected-first-red status', () => {
  const s = levelNineArmoryState();
  const topbar = renderTopbarInfo(s, 1234);
  assert.match(topbar, /指挥官/);
  assert.match(topbar, /Lv\.30/);
  assert.match(topbar, /MAX/);

  setGallerySeries('g_red');
  const gallery = renderGalleryPanel(s);
  assert.match(gallery, /显卡/);
  assert.match(gallery, /首件保护/);

  setWarehouseCat('collectible');
  const warehouse = renderWarehousePanel(s);
  assert.match(warehouse, /显卡/);
  assert.match(warehouse, /首件保护/);
  assert.match(warehouse, /可用重复件\s*1/);
});
