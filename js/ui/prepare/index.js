/**
 * 作战准备视图容器
 * 五个模块以标签页形式展示，同一时刻仅展开一个（需求 4.2）
 * 出发按钮的启用条件与缺失项提示（需求 4.4 / 4.5）
 */

import { MAPS, DIFFICULTY_META, getMapCover, SLOTS, getTemplate, getBranch } from '../../config/index.js';
import { getState, notify, VIEW } from '../../core/state.js';
import { fmt, fmtTime, esc } from '../../core/utils.js';
import { getReadiness, checkThreshold, squadBagCapacity } from '../../systems/readiness.js';
import { computeTimeLimit, extractDuration } from '../../systems/extraction.js';
import { warehouseSummary, galleryProgress } from '../../systems/collection.js';
import { squadCombatStats, operatorListView } from '../../systems/operator.js';
import { operatorGearStats } from '../../systems/equipment.js';
import { previewAmmoState, ROUNDS_FOR_FULL_RUN } from '../../systems/ammo.js';
import { delegate, toast, statCard } from '../components.js';
import { avatarArt } from '../pixelAvatar.js';
import { itemArt, slotArt } from '../itemArt.js';
import { renderMapPanel, selectBranch, openMapDifficulty, spawnSpotHit, openOpsCenter } from './mapPanel.js';
import { renderOperatorPanel, handleToggleSquad, handleUpgradeOperator, handleRecruit, handleOperatorDetail, handleHiddenDetail } from './operatorPanel.js';
import {
  renderEquipmentPanel, setEquipSubTab, openSlotPicker, handleEquipByUid, handleUnequip,
  handleAutoEquip, handleAutoEquipSquad, handleClearLoadout, handleClearAllLoadouts,
  handleSelectEquipOperator, handleBuyEquipment, handleBuyMaterial, handleSell,
  handleBuyAmmo, handleSelectAmmo, handleSetCarryRounds, handleCarryMax, handleSellAmmo,
  handleApplyLoadoutPreset, handleSaveLoadoutPreset
} from './equipmentPanel.js';
import {
  renderWarehousePanel, handleWarehouseCat, handleWarehouseSellEquipment,
  handleSellCollectible, handleSellMaterial, handleCollectibleDetail,
  handleWarehouseSellAmmo, handleWarehouseBatchSell, handleWarehouseAutoSort,
  handleDiscardLegacyAmmo, handleDiscardLegacyEquipment
} from './warehousePanel.js';
import { renderGalleryPanel, handleGallerySeries, handleGalleryEntry } from './galleryPanel.js';
import { openFacilityDetail, renderBasePanel } from './basePanel.js';

const TABS = [
  { id: 'map', name: '地图与行动', icon: '🗺️' },
  { id: 'operator', name: '干员编成', icon: '🎖️' },
  { id: 'equipment', name: '装备配置', icon: '🔫' },
  { id: 'warehouse', name: '仓库', icon: '📦' },
  { id: 'gallery', name: '收藏室', icon: '🏛️' },
  { id: 'base', name: '基地', icon: '🏗️' }
];

/** 难度配色 → 项目内真实可用的类名（避免 amber / violet 等无效类） */
const DIFF_TONE = {
  sky: { text: 'text-sky-400', border: 'border-sky-400/50' },
  amber: { text: 'text-amber-400', border: 'border-amber-400/50' },
  rust: { text: 'text-rust', border: 'border-rust/50' },
  violet: { text: 'text-fuchsia-400', border: 'border-fuchsia-400/50' }
};

function diffTone(color) {
  return DIFF_TONE[color] || { text: 'text-delta', border: 'border-delta/50' };
}

let el = null;
let launchHandler = null;

/** 注册出发回调（由 main 提供，避免循环依赖） */
export function onLaunch(fn) { launchHandler = fn; }

export function getPrepareEl() {
  el = el || document.getElementById('view-prepare');
  return el;
}

export function mountPrepare() {
  const root = getPrepareEl();
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';
  bind(root);
}

/** 出发前置检查，返回缺失项列表 */
export function launchCheck(s = getState()) {
  const missing = [];
  const { mapId, difficulty } = s.selection;

  if (!mapId || !difficulty) {
    missing.push('尚未选定地图与行动难度');
  }
  if (s.operators.squad.length === 0) {
    missing.push('至少需要上阵 1 名干员');
  }
  if (mapId && difficulty) {
    const chk = checkThreshold(mapId, difficulty, s);
    if (!chk.ok) {
      missing.push(`战备价值不足：需要 ${fmt(chk.required)}，当前 ${fmt(chk.current)}，还差 ${fmt(chk.gap)}`);
    }
  }

  // 弹药为软性检查：未带弹仍可出发，但枪械无法开火，只能靠技能
  const ammoState = previewAmmoState(s);
  const warnings = [];
  if (s.operators.squad.length > 0 && ammoState.rounds <= 0) {
    warnings.push('未携带弹药：枪械无法开火，全程只能依靠技能造成伤害');
  } else if (s.operators.squad.length > 0 && ammoState.rounds < ROUNDS_FOR_FULL_RUN) {
    warnings.push(`携带 ${ammoState.rounds} 发，不足全程所需的 ${ROUNDS_FOR_FULL_RUN} 发，行动后段可能弹尽`);
  }

  return { ok: missing.length === 0, missing, warnings, ammo: ammoState };
}

export function renderPrepare() {
  const root = getPrepareEl();
  if (!root || root.classList.contains('hidden')) return;

  const s = getState();
  const tab = TABS.some((t) => t.id === s.activeTab) ? s.activeTab : 'map';
  const inOps = tab !== 'map';
  const active = TABS.find((t) => t.id === tab) || TABS[0];

  root.innerHTML = `
    ${renderBriefing(s)}
    ${inOps ? renderOpsHeader(active) : ''}
    <div>
      ${tab === 'map' ? renderMapPanel() : ''}
      ${tab === 'operator' ? renderOperatorPanel() : ''}
      ${tab === 'equipment' ? renderEquipmentPanel() : ''}
      ${tab === 'warehouse' ? renderWarehousePanel() : ''}
      ${tab === 'gallery' ? renderGalleryPanel() : ''}
      ${tab === 'base' ? renderBasePanel() : ''}
    </div>
  `;
}

/** 进入特勤处某个模块后的顶部导航条，提供返回沙盘的路径 */
function renderOpsHeader(active) {
  return `
    <section class="clip-corner bg-panel border border-delta/50 mb-4 px-4 py-2.5 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-base">🏢</span>
        <span class="text-xs text-delta tracking-wider truncate">
          特勤处 · ${esc(active.name)}
        </span>
      </div>
      <button data-action="tab" data-tab="map"
        class="btn clip-tab px-3 py-1.5 text-[10px] border border-line bg-panel2 text-sand/60 hover:text-sand shrink-0">
        ← 返回战术沙盘
      </button>
    </section>
  `;
}

/** 顶部行动简报与出发按钮（图形化：战区实景 + 干员头像 + 装备槽） */
function renderBriefing(s) {
  const { mapId, difficulty } = s.selection;
  const map = MAPS.find((m) => m.id === mapId) || null;
  const meta = difficulty ? DIFFICULTY_META[difficulty] : null;
  const check = launchCheck(s);
  const readiness = getReadiness(s);
  const bagCapacity = squadBagCapacity(s);
  const wh = warehouseSummary(s);
  const gl = galleryProgress(s);
  const stats = squadCombatStats(s);
  const timeLimit = map && meta ? computeTimeLimit(mapId, difficulty, s) : 0;
  const extractSec = extractDuration(s);

  return `
    <section class="clip-corner bg-panel border ${check.ok ? 'border-delta/50' : 'border-line'} mb-4 overflow-hidden">
      <div class="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
        <div class="min-w-0 flex items-center gap-2">
          <span class="text-base">🎯</span>
          <div class="min-w-0">
            <h2 class="text-sm text-delta tracking-wider">作战准备 · 行动简报</h2>
            <p class="text-[10px] text-sand/40 mt-0.5">
              ${map && meta ? `${esc(map.name)} · ${esc(meta.name)}` : '尚未选定行动'}
            </p>
          </div>
        </div>
        <button data-action="launch" ${check.ok ? '' : 'disabled'}
          class="btn clip-tab px-5 md:px-8 py-2.5 text-sm border ${check.ok ? 'border-delta bg-delta/20 text-delta btn-go-ready' : 'border-line bg-panel2 text-sand/35'}">
          ▶ 出发
        </button>
      </div>

      <div class="brief-grid p-3">
        ${renderBriefMapCard(map, meta, s)}
        ${renderBriefSquad(s)}
        ${renderBriefGear(s, stats)}
      </div>

      <div class="px-3 pb-3 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        ${statCard({ label: '战备 / 装备价值', value: fmt(readiness), tone: 'delta' })}
        ${statCard({ label: '上阵干员', value: `${s.operators.squad.length} / 3`, tone: s.operators.squad.length ? 'sand' : 'rust' })}
        ${statCard({
          label: '携带弹药',
          value: `${fmt(check.ammo.rounds)} 发`,
          sub: check.ammo.rounds > 0 ? `${esc(check.ammo.name)} · 不计战备` : '未带弹 · 仅技能',
          tone: check.ammo.rounds >= ROUNDS_FOR_FULL_RUN ? 'delta' : (check.ammo.rounds > 0 ? 'amber' : 'rust')
        })}
        ${statCard({ label: '行动时限', value: timeLimit ? fmtTime(timeLimit) : '—', tone: 'amber' })}
        ${statCard({ label: '撤离读条', value: `${extractSec.toFixed(1)}s`, tone: 'sky' })}
        ${statCard({ label: '背包容量', value: `${bagCapacity} 格`, sub: '全队背包容量叠加', tone: bagCapacity ? 'sky' : 'rust' })}
        ${statCard({ label: '仓库库存', value: `${wh.equipment.count + wh.collectible.count + wh.material.count} 件`, sub: `图鉴 ${gl.owned}/${gl.total} · 价值 ${fmt(wh.totalValue)}`, tone: 'amber' })}
        ${statCard({ label: '小队战力', value: `${fmt(stats.atk)} / ${fmt(stats.hp)}`, sub: '攻击 / 生命', tone: 'sand' })}
      </div>

      ${check.warnings.length ? `
        <div class="px-4 py-2 border-t border-line bg-amber-400/5">
          <ul class="text-[11px] text-amber-400 space-y-0.5">
            ${check.warnings.map((w) => `<li>⚠ ${esc(w)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${check.ok ? `
        <div class="px-4 py-2 border-t border-line bg-delta/5">
          <p class="text-[11px] text-delta">✔ 全部准备就绪，点击出发进入探索视图</p>
        </div>
      ` : `
        <div class="px-4 py-2 border-t border-line bg-rust/5">
          <p class="text-[11px] text-rust mb-1">✖ 尚不满足出发条件：</p>
          <ul class="text-[11px] text-sand/60 space-y-0.5">
            ${check.missing.map((m) => `<li>· ${esc(m)}</li>`).join('')}
          </ul>
        </div>
      `}
    </section>
  `;
}

/** 左侧：战区实景卡片（有实景图用图，缺省回落到沙盘底图） */
function renderBriefMapCard(map, meta, s) {
  if (!map || !meta) {
    return `
      <div class="brief-card brief-map clip-tab border border-dashed border-line bg-panel2 flex flex-col items-center justify-center text-center px-3 py-6">
        <span class="text-2xl opacity-40">🗺️</span>
        <p class="text-[11px] text-sand/45 mt-2">尚未选定战区</p>
        <button data-action="open-ops-map" class="btn clip-tab mt-2 px-3 py-1.5 text-[10px] border border-delta/50 bg-delta/10 text-delta">
          前往战术沙盘
        </button>
      </div>
    `;
  }

  const branch = getBranch(map.id, meta.id);
  const art = (branch && branch.art) || getMapCover(map.id);
  const tone = diffTone(meta.color);

  return `
    <div class="brief-card brief-map clip-tab border border-line bg-panel2 relative overflow-hidden">
      <img src="${esc(art)}" alt="${esc(map.name)}" class="brief-map-img" loading="lazy">
      <div class="brief-map-veil"></div>
      <span class="brief-diff ${tone.text} ${tone.border}">${esc(meta.short)}</span>
      <div class="brief-map-body">
        <p class="text-[13px] text-sand tracking-wider leading-tight">${esc(map.name)}</p>
        <p class="text-[9px] text-sand/40 tracking-[0.18em] mt-0.5">${esc(map.subtitle || '')}</p>
        <div class="flex flex-wrap gap-1.5 mt-2">
          <span class="brief-chip ${tone.text}">${esc(meta.dangerText)}</span>
          <span class="brief-chip text-sand/60">${esc(meta.lootTierText)}</span>
          ${branch && branch.level ? `<span class="brief-chip text-sand/60">Lv.${branch.level}+</span>` : ''}
        </div>
      </div>
      <button data-action="open-ops-map" class="brief-map-btn" title="返回战术沙盘调整行动">调整</button>
    </div>
  `;
}

/** 中部：上阵干员头像位（空位显示虚线占位） */
function renderBriefSquad(s) {
  const all = operatorListView(s);
  const squad = s.operators.squad.map((id) => all.find((o) => o.id === id)).filter(Boolean);

  const slots = Array.from({ length: 3 }).map((_, i) => {
    const op = squad[i];
    if (!op) {
      return `
        <div class="brief-op brief-op-empty clip-tab border border-dashed border-line bg-panel/50">
          <div class="brief-op-art flex items-center justify-center text-sand/25 text-lg">＋</div>
          <span class="brief-op-name text-sand/25">空席 ${i + 1}</span>
        </div>
      `;
    }
    return `
      <button data-action="op-detail" data-id="${op.id}"
        class="btn brief-op clip-tab border bd-${op.rarity} bg-panel2"
        title="${esc(op.name)} · ${esc(op.roleFullName)}｜点击查看技能档案">
        <div class="brief-op-art">${avatarArt(op, false)}</div>
        <span class="brief-op-mark">${esc(op.roleMark || '▲')}</span>
        <span class="brief-op-lv">Lv.${op.level}</span>
        <span class="brief-op-name rar-${op.rarity}">${esc(op.name)}</span>
      </button>
    `;
  }).join('');

  return `
    <div class="brief-card clip-tab border border-line bg-panel2 p-2.5">
      <div class="flex items-baseline justify-between mb-2">
        <h3 class="text-[11px] text-delta tracking-wider">上阵干员</h3>
        <span class="text-[10px] ${squad.length ? 'text-delta' : 'text-rust'}">${squad.length} / 3</span>
      </div>
      <div class="brief-op-row">${slots}</div>
      <button data-action="tab" data-tab="operator"
        class="btn clip-tab w-full mt-2 py-1.5 text-[10px] border border-line bg-panel/60 text-sand/55 hover:text-sand">
        调整编成 →
      </button>
    </div>
  `;
}

/** 右侧：各干员携带装备缩略 */
function renderBriefGear(s, stats) {
  const all = operatorListView(s);
  const squad = (s.operators.squad || [])
    .map((id) => all.find((o) => o.id === id))
    .filter(Boolean);

  const totalSlots = squad.length * SLOTS.length;
  let equipped = 0;

  const rows = squad.map((op) => {
    const slotsState = s.loadouts?.[op.id] || {};
    const cells = SLOTS.map((slot) => {
      const uid = slotsState[slot.id];
      const inst = uid ? s.inventory.find((it) => it.uid === uid) : null;
      const tpl = inst ? getTemplate(inst.tplId) : null;
      if (!tpl) {
        return `<span class="brief-gear brief-gear-empty clip-tab border border-dashed border-line bg-panel/50" title="${esc(slot.name)} 未装备">
          <span class="brief-gear-icon opacity-30">${slotArt(slot, { size: 'sm' })}</span>
        </span>`;
      }
      equipped += 1;
      return `<span class="brief-gear clip-tab border bd-${tpl.rarity} bg-panel2" title="${esc(tpl.name)} · ${esc(slot.name)}">
        <span class="brief-gear-icon">${itemArt(tpl, { size: 'sm' })}</span>
      </span>`;
    }).join('');

    const g = operatorGearStats(op.id, s);
    return `
      <button data-action="brief-gear-op" data-id="${op.id}"
        class="btn brief-gear-line" title="点击配置 ${esc(op.name)} 的装备">
        <span class="brief-gear-face">${avatarArt(op, false)}</span>
        <span class="brief-gear-cells">${cells}</span>
        <span class="text-[10px] ${g.value ? 'text-delta' : 'text-sand/30'} shrink-0">+${fmt(g.value)}</span>
      </button>
    `;
  }).join('');

  return `
    <div class="brief-card clip-tab border border-line bg-panel2 p-2.5">
      <div class="flex items-baseline justify-between mb-2">
        <h3 class="text-[11px] text-delta tracking-wider">各干员携带装备</h3>
        <span class="text-[10px] ${equipped ? 'text-delta' : 'text-rust'}">${equipped} / ${totalSlots || SLOTS.length}</span>
      </div>
      ${squad.length ? `<div class="space-y-1.5">${rows}</div>` : `
        <p class="text-[11px] text-sand/35 py-3 text-center">上阵干员后可为每人分别配装</p>
      `}
      <div class="flex items-center gap-2 mt-2">
        <span class="text-[10px] text-sand/40 shrink-0">防御 ${fmt(stats.def)}</span>
        <div class="brief-bar grow">
          <span class="brief-bar-fill" style="width:${totalSlots ? Math.round((equipped / totalSlots) * 100) : 0}%"></span>
        </div>
        <button data-action="tab" data-tab="equipment"
          class="btn clip-tab px-2 py-1 text-[10px] border border-line bg-panel/60 text-sand/55 hover:text-sand shrink-0">
          配置 →
        </button>
      </div>
    </div>
  `;
}

/* ============ 事件绑定 ============ */

function bind(root) {
  delegate(root, {
    tab: ({ tab }) => {
      const s = getState();
      s.activeTab = tab;
      notify();
    },

    'open-map': ({ map }, el, e) => { spawnSpotHit(el, e); openMapDifficulty(map); },
    'open-ops-map': () => {
      const s = getState();
      s.activeTab = 'map';
      notify();
    },
    'open-ops': (d, el, e) => { spawnSpotHit(el, e); openOpsCenter(); },
    'select-branch': ({ map, diff }) => { selectBranch(map, diff); },

    launch: () => {
      const s = getState();
      const check = launchCheck(s);
      if (!check.ok) {
        toast(check.missing[0], 'err');
        return;
      }
      if (typeof launchHandler === 'function') launchHandler();
    },

  'op-detail': ({ id }) => handleOperatorDetail(id),
  'op-hidden': ({ id }) => handleHiddenDetail(id),
    'op-toggle': ({ id }) => handleToggleSquad(id),
    'op-upgrade': ({ id }) => handleUpgradeOperator(id),
    'op-recruit': ({ id }) => handleRecruit(id),

    'eq-subtab': ({ sub }) => { setEquipSubTab(sub); notify(); },
    'eq-op': ({ id }) => handleSelectEquipOperator(id),
    'brief-gear-op': ({ id }) => {
      const s = getState();
      setEquipSubTab('loadout');
      handleSelectEquipOperator(id);
      s.activeTab = 'equipment';
      notify();
    },
    'eq-pick': ({ slot, id }) => openSlotPicker(slot, id || null),
    'eq-unequip': ({ slot, id }) => handleUnequip(slot, id || null),
    'eq-equip-uid': ({ uid }) => handleEquipByUid(uid),
    'eq-auto': () => handleAutoEquip(),
    'eq-auto-squad': () => handleAutoEquipSquad(),
    'eq-preset-save': ({ slot }) => handleSaveLoadoutPreset(slot),
    'eq-preset-apply': ({ slot }) => handleApplyLoadoutPreset(slot),
    'eq-clear': () => handleClearLoadout(),
    'eq-clear-all': () => handleClearAllLoadouts(),
    'eq-sell': ({ uid }) => handleSell(uid),
    'shop-buy-eq': ({ tpl }) => handleBuyEquipment(tpl),
    'shop-buy-mat': ({ tpl }) => handleBuyMaterial(tpl),

    'ammo-buy': ({ tpl, n }) => handleBuyAmmo(tpl, Number(n) || 0),
    'ammo-select': ({ tpl }) => handleSelectAmmo(tpl),
    'ammo-carry': ({ n }) => handleSetCarryRounds(Number(n) || 0),
    'ammo-carry-max': () => handleCarryMax(),
    'ammo-sell': ({ tpl }) => handleSellAmmo(tpl),

    'wh-cat': ({ cat }) => handleWarehouseCat(cat),
    'wh-sell-eq': ({ uid }) => handleWarehouseSellEquipment(uid),
    'wh-sell-ammo': ({ tpl }) => handleWarehouseSellAmmo(tpl),
    'wh-discard-legacy-eq': ({ uid }) => handleDiscardLegacyEquipment(uid),
    'wh-discard-legacy-ammo': ({ tpl }) => handleDiscardLegacyAmmo(tpl),
    'wh-sell-col': ({ id }) => handleSellCollectible(id),
    'wh-sell-mat': ({ id }) => handleSellMaterial(id),
    'wh-col-detail': ({ id }) => handleCollectibleDetail(id),
    'wh-batch-sell': ({ cat }) => handleWarehouseBatchSell(cat),
    'wh-auto-sort': () => handleWarehouseAutoSort(),

    'gl-series': ({ id }) => handleGallerySeries(id || null),
    'gl-entry': ({ id }) => handleGalleryEntry(id),
    'base-facility': ({ id }) => openFacilityDetail(id)
  });
}

export function unmountPrepare() {
  // 准备视图无动画循环，隐藏即停止渲染
}

export const PREPARE_VIEW_NAME = VIEW.PREPARE;
