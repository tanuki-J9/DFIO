/**
 * 地图与行动选择模块
 * 交互流程：等距沙盘底图上点击据点 → 弹出该地图的难度选择弹窗
 * 弹窗内逐档展示最低战备要求、行动时限、战利品档位与危险程度（需求 5.8）
 */

import {
  MAPS, MAP_BACKGROUND, DIFFICULTY_META, getMapMinReadiness, scaledReadiness, getBranch, getMap, SLOTS
} from '../../config/index.js';
import { getState, notify } from '../../core/state.js';
import { fmt, fmtTime, esc } from '../../core/utils.js';
import { getReadiness, checkThreshold } from '../../systems/readiness.js';
import { computeTimeLimit } from '../../systems/extraction.js';
import { warehouseSummary, galleryProgress } from '../../systems/collection.js';
import { totalSkillLevels } from '../../systems/skill.js';
import { toast, openPanel, delegate } from '../components.js';

const DANGER_COLORS = {
  1: { dot: 'bg-sky-400', text: 'text-sky-400', border: 'border-sky-400/50', bg: 'bg-sky-400/10' },
  2: { dot: 'bg-amber-400', text: 'text-amber-400', border: 'border-amber-400/50', bg: 'bg-amber-400/10' },
  3: { dot: 'bg-rust', text: 'text-rust', border: 'border-rust/50', bg: 'bg-rust/10' },
  4: { dot: 'bg-fuchsia-400', text: 'text-fuchsia-400', border: 'border-fuchsia-400/50', bg: 'bg-fuchsia-400/10' }
};

/** 当前打开的难度弹窗句柄，避免重复叠加 */
let openMapModal = null;

/**
 * 特勤处：底图中央的后勤设施，点击展开干员编成 / 装备配置 / 仓库 / 收藏室 / 技能升级
 * 坐标对准底图上已绘制的特勤处建筑
 */
const OPS_SPOT = { x: 47.2, y: 46.5 };

/** 特勤处内聚合的功能入口 */
const OPS_ENTRIES = [
  { id: 'operator', name: '干员编成', icon: '🎖️', desc: '招募干员、编成上阵小队与干员升级' },
  { id: 'equipment', name: '装备配置', icon: '🔫', desc: '为每名干员配装，并采购所需装备' },
  { id: 'warehouse', name: '仓库', icon: '📦', desc: '装备、收藏品与材料的分类库存管理' },
  { id: 'gallery', name: '收藏室', icon: '🏛️', desc: '图鉴：记录历史上获得过的每一件大红' },
  { id: 'skill', name: '技能升级', icon: '🧠', desc: '强化小队永久战斗能力' }
];

/* ============ 沙盘地图 ============ */

export function renderMapPanel() {
  const s = getState();
  const readiness = getReadiness(s);

  return `
    <div class="mb-4 clip-tab bg-panel2 border border-line px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
      <div>
        <p class="text-[10px] text-sand/45">当前战备</p>
        <p class="text-lg text-delta leading-tight">${fmt(readiness)}</p>
      </div>
      <p class="text-[11px] text-sand/50 leading-relaxed max-w-2xl">
        点击战术沙盘上的据点查看该战区的全部行动难度。普通行动无门槛；
        机密、绝密与永恒行动均设有最低战备要求，难度越高战利品档位越高、
        行动时限越紧张、撤离失败损失越大。
      </p>
    </div>

    <section class="clip-corner bg-panel border border-line overflow-hidden">
      <header class="px-4 py-2.5 border-b border-line flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <span class="danger-dot bg-delta"></span>
          <h3 class="text-xs text-delta tracking-[0.2em]">战术沙盘 · TACTICAL MAP</h3>
        </div>
        <span class="text-[10px] text-sand/40 shrink-0">${MAPS.length} 个可进入战区</span>
      </header>

      <div class="map-board relative select-none">
        <img src="${MAP_BACKGROUND}" alt="战区沙盘" class="map-board-img block w-full h-auto" draggable="false" />
        <div class="map-board-scan"></div>
        ${MAPS.map((map) => renderSpot(map, s, readiness)).join('')}
        ${renderOpsSpot(s)}
      </div>

      <footer class="px-4 py-2.5 border-t border-line flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span class="flex items-center gap-1.5 text-[10px] text-sand/45">
          <span class="danger-dot bg-delta"></span>可进入
        </span>
        <span class="flex items-center gap-1.5 text-[10px] text-sand/45">
          <span class="danger-dot bg-rust"></span>战备不足
        </span>
        <span class="flex items-center gap-1.5 text-[10px] text-sand/45">
          <span class="danger-dot bg-sky-400"></span>特勤处（后勤）
        </span>
        <span class="text-[10px] text-sand/35">提示：点击据点选择行动难度，点击特勤处进行战前准备</span>
      </footer>
    </section>
  `;
}

/** 底图上的特勤处热点 */
function renderOpsSpot(s) {
  const ready = s.operators.squad.length > 0;

  return `
    <button data-action="open-ops"
      class="map-spot is-ops" style="left:${OPS_SPOT.x}%; top:${OPS_SPOT.y}%"
      aria-label="特勤处">
      <span class="map-spot-ring"></span>
      <span class="map-spot-core"></span>
      <span class="map-spot-label">
        <span class="map-spot-name">特勤处</span>
        <span class="map-spot-meta">${ready ? '战前准备' : '尚未编成'}</span>
      </span>
    </button>
  `;
}

/** 点击特勤处后弹出功能入口列表 */
export function openOpsCenter() {
  const s = getState();
  const wh = warehouseSummary(s);
  const gl = galleryProgress(s);
  const squadCount = (s.operators.squad || []).filter(Boolean).length;
  const equippedCount = Object.entries(s.loadouts || {})
    .filter(([opId]) => (s.operators.squad || []).includes(opId))
    .reduce((sum, [, slots]) => sum + Object.values(slots || {}).filter(Boolean).length, 0);
  const badges = {
    operator: `${s.operators.squad.length} / 3 上阵`,
    equipment: `${equippedCount} / ${squadCount * SLOTS.length || SLOTS.length} 已装备`,
    warehouse: `${wh.equipment.count + wh.collectible.count + wh.material.count} 件 · 价值 ${fmt(wh.totalValue)}`,
    gallery: `图鉴 ${gl.owned} / ${gl.total}`,
    skill: `已投入 ${fmt(totalSkillLevels(s))} 级`
  };

  const handle = openPanel({
    title: '特勤处 · 战前准备',
    bodyHtml: `
      <div class="op-body">
        <p class="op-desc mb-3">
          特勤处是三角洲小队的后勤枢纽。在此完成干员编成与装备配置，
          在仓库整理装备、收藏品与材料，并在收藏室回顾历史上带出过的每一件大红。
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          ${OPS_ENTRIES.map((t) => `
            <button data-action="go-ops" data-tab="${t.id}"
              class="btn clip-tab px-3 py-3 text-left border border-line bg-panel2 hover:border-delta/60">
              <span class="flex items-center gap-2">
                <span class="text-base">${t.icon}</span>
                <span class="text-xs text-sand">${esc(t.name)}</span>
              </span>
              <span class="block text-[10px] text-sand/40 mt-1 leading-snug">${esc(t.desc)}</span>
              <span class="block text-[10px] text-delta/70 mt-1">${esc(badges[t.id] || '')}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `,
    onMount: (body, close) => {
      delegate(body, {
        'go-ops': ({ tab }) => {
          const st = getState();
          st.activeTab = tab;
          close();
          notify();
        }
      });
    }
  });
  return handle;
}

/** 底图上的单个据点热点 */
function renderSpot(map, s, readiness) {
  // 门槛同样按出战人数倍增，与弹窗内判定保持一致
  const minReq = scaledReadiness(getMapMinReadiness(map), s?.operators?.squad);
  const locked = readiness < minReq;
  const selected = s.selection.mapId === map.id;
  const selMeta = selected && s.selection.difficulty ? DIFFICULTY_META[s.selection.difficulty] : null;
  const passCount = map.branches.filter((b) => checkThreshold(map.id, b.difficulty, s).ok).length;

  const tone = locked ? 'is-locked' : selected ? 'is-selected' : 'is-open';

  return `
    <button data-action="open-map" data-map="${map.id}"
      class="map-spot ${tone}" style="left:${map.spot.x}%; top:${map.spot.y}%"
      aria-label="${esc(map.name)}">
      <span class="map-spot-ring"></span>
      <span class="map-spot-core"></span>
      <span class="map-spot-label">
        <span class="map-spot-name">${esc(map.name)}</span>
        <span class="map-spot-meta">
          ${locked
            ? '战备不足'
            : selMeta
              ? esc(selMeta.short)
              : `${passCount}/${map.branches.length} 档可入`}
        </span>
      </span>
    </button>
  `;
}

/* ============ 点击反馈 ============ */

/**
 * 在被点击的据点上生成一圈扩散冲击波，作为点击命中反馈
 * @param {HTMLElement} el 被点击的据点按钮
 * @param {MouseEvent} e   点击事件，用于取落点坐标
 */
export function spawnSpotHit(el, e) {
  if (!el || !el.classList || !el.classList.contains('map-spot')) return;
  const board = el.parentElement;
  if (!board) return;

  const rect = board.getBoundingClientRect();
  const spot = el.getBoundingClientRect();
  // 默认落在据点中心，若有鼠标坐标则以实际点击点为准
  let x = spot.left + spot.width / 2 - rect.left;
  let y = spot.top + spot.height / 2 - rect.top;
  if (e && typeof e.clientX === 'number' && e.clientX !== 0) {
    x = e.clientX - rect.left;
    y = e.clientY - rect.top;
  }

  const hit = document.createElement('span');
  hit.className = `map-spot-hit${el.classList.contains('is-locked') ? ' is-locked' : ''}`;
  hit.style.left = `${x}px`;
  hit.style.top = `${y}px`;
  board.appendChild(hit);
  setTimeout(() => hit.remove(), 520);
}

/* ============ 难度选择弹窗 ============ */

/** 点击据点后弹出该地图的难度列表 */
export function openMapDifficulty(mapId) {
  const map = getMap(mapId);
  if (!map) {
    toast('该地图不存在', 'err');
    return;
  }
  if (openMapModal) {
    openMapModal.close();
    openMapModal = null;
  }

  // 默认停留在第一档（通常是该图门槛最低的难度）
  let activeDiff = map.branches[0].difficulty;
  const sel = getState().selection;
  if (sel.mapId === map.id && map.branches.some((b) => b.difficulty === sel.difficulty)) {
    activeDiff = sel.difficulty;
  }

  const handle = openPanel({
    title: `${map.name} · 行动简报`,
    bodyHtml: renderDifficultyBody(map, activeDiff),
    onMount: (body, close) => {
      const repaint = () => { body.innerHTML = renderDifficultyBody(map, activeDiff); };
      delegate(body, {
        'switch-diff': ({ diff }) => {
          if (diff === activeDiff) return;
          activeDiff = diff;
          repaint();
        },
        'start-op': ({ diff }) => {
          if (selectBranch(map.id, diff)) {
            close();
            openMapModal = null;
          } else {
            repaint();
          }
        }
      });
    }
  });
  openMapModal = handle;
}

/** 弹窗主体：顶部难度页签 + 当前难度的详情 */
function renderDifficultyBody(map, activeDiff) {
  const s = getState();
  const branch = map.branches.find((b) => b.difficulty === activeDiff) || map.branches[0];
  const meta = DIFFICULTY_META[branch.difficulty];
  const dc = DANGER_COLORS[meta.danger] || DANGER_COLORS[1];
  const chk = checkThreshold(map.id, branch.difficulty, s);
  const selected = s.selection.mapId === map.id && s.selection.difficulty === branch.difficulty;
  const timeLimit = computeTimeLimit(map.id, branch.difficulty, s);
  const total = branch.weights.crate + branch.weights.enemy + branch.weights.boss;
  const pct = (n) => `${Math.round((n / total) * 100)}%`;

  return `
    <div class="op-tabs grid" style="grid-template-columns:repeat(${map.branches.length},minmax(0,1fr))">
      ${map.branches.map((b) => {
        const m = DIFFICULTY_META[b.difficulty];
        const on = b.difficulty === activeDiff;
        return `
          <button data-action="switch-diff" data-diff="${b.difficulty}"
            class="op-tab ${on ? 'is-on' : ''}">
            <span class="op-tab-name">${esc(m.name)}</span>
            <span class="op-tab-sub">${esc(m.short)} · ${esc(m.dangerText)}</span>
          </button>`;
      }).join('')}
    </div>

    <div class="op-body">
      <div class="op-hero map-art-${esc(map.theme)}">
        <span class="op-hero-code">${esc(map.subtitle)} // ${meta.lootTier}</span>
        <h4 class="op-hero-title">${esc(map.name)}-${esc(meta.short)}</h4>
        <div class="op-hero-danger">
          ${Array.from({ length: 4 }, (_, i) =>
            `<span class="w-1.5 h-4 ${i < meta.danger ? dc.dot : 'bg-white/15'}"></span>`
          ).join('')}
          <span class="text-[10px] ${dc.text} ml-1">${esc(meta.dangerText)}</span>
        </div>
      </div>

      <div class="op-rare">
        <span class="op-rare-text">${esc(branch.rare)}</span>
        <span class="op-rare-tier ${dc.text}">${meta.lootTier} · ${esc(meta.lootTierText)}</span>
      </div>

      <dl class="op-rows">
        ${row('行动难度', `<span class="${dc.text}">${esc(meta.name)}</span>`)}
        ${row('准入价值', branch.readiness > 0
          ? `<span class="${chk.ok ? 'text-sand' : 'text-rust'}">${fmt(chk.required)}</span>
             <span class="op-row-note">${fmt(branch.readiness)} × ${chk.squadSize}人${chk.ok ? '' : ` · 还差 ${fmt(chk.gap)}`}</span>`
          : '<span class="text-sand">无限制</span>')}
        ${row('等级限制', branch.level > 0
          ? `<span class="text-sand">Lv.${branch.level}</span>`
          : '<span class="text-sand">无限制</span>')}
        ${row('行动时限', `<span class="text-amber-400">${fmtTime(timeLimit)}</span>`)}
        ${row('推进间隔', `<span class="text-sky-400">${branch.nodeGap.toFixed(1)}s</span>`)}
        ${row('节点构成', `<span class="text-sand/70 text-xs">补给箱 ${pct(branch.weights.crate)} · 敌人 ${pct(branch.weights.enemy)} · 首领 ${pct(branch.weights.boss)}</span>`)}
      </dl>

      <p class="op-desc">${esc(map.desc)}</p>

      <button data-action="start-op" data-diff="${branch.difficulty}"
        class="op-start ${chk.ok ? 'is-ready' : 'is-locked'}">
        ${chk.ok ? (selected ? '重新选定此行动' : '开始行动') : `战备不足 · 还差 ${fmt(chk.gap)}`}
      </button>
    </div>
  `;
}

/** 详情行 */
function row(label, valueHtml) {
  return `
    <div class="op-row">
      <dt class="op-row-label">${esc(label)}:</dt>
      <dd class="op-row-value">${valueHtml}</dd>
    </div>`;
}

/** 选择行动分支 */
export function selectBranch(mapId, difficulty) {
  const s = getState();
  if (s.run) {
    toast('行动进行中，请先完成本轮结算', 'warn');
    return false;
  }
  const branch = getBranch(mapId, difficulty);
  if (!branch) {
    toast('该行动分支不存在', 'err');
    return false;
  }

  const chk = checkThreshold(mapId, difficulty, s);
  if (!chk.ok) {
    toast(`战备不足：需要 ${fmt(chk.required)}，当前 ${fmt(chk.current)}，还差 ${fmt(chk.gap)}`, 'err');
    // 仍记录选择，便于玩家看到差距并去配装
    s.selection.mapId = mapId;
    s.selection.difficulty = difficulty;
    notify();
    return false;
  }

  s.selection.mapId = mapId;
  s.selection.difficulty = difficulty;
  notify();
  const map = getMap(mapId);
  toast(`已选定 ${map?.name || ''} · ${DIFFICULTY_META[difficulty].name}`, 'ok');
  return true;
}
