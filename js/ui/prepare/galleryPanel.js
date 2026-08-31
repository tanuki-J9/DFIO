/**
 * 特勤处 · 收藏室模块（图鉴壳子）
 * 记录曾经获得过的「大红」条目，未收录条目以剪影占位
 * 本阶段仅提供数据结构与界面壳子，收录奖励与更多系列留待后续
 */

import { getState, notify } from '../../core/state.js';
import { fmt, esc, fmtClock } from '../../core/utils.js';
import { galleryView, isDiscovered } from '../../systems/collection.js';
import { protectedCollectibleCount } from '../../systems/base.js';
import { toast, emptyState, statCard, openPanel, progressBar } from '../components.js';

/** 当前展开的系列；null 表示全部系列平铺 */
let activeSeries = null;

export function setGallerySeries(id) {
  activeSeries = id || null;
}

export function renderGalleryPanel(s = getState()) {
  const view = galleryView(s);
  const series = activeSeries
    ? view.series.filter((g) => g.id === activeSeries)
    : view.series;

  return `
    <section class="clip-corner bg-panel border border-line overflow-hidden mb-4">
      <header class="px-4 py-2.5 border-b border-line flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-base">🏛️</span>
          <h3 class="text-xs text-delta tracking-[0.2em]">收藏室 · GALLERY</h3>
        </div>
        <span class="text-[10px] text-sand/40 shrink-0">收录 ${view.owned} / ${view.total}</span>
      </header>
      <div class="p-3">
        <p class="text-[11px] text-sand/50 leading-relaxed mb-3">
          收藏室记录小队历史上获得过的每一件<span class="text-amber-400">大红</span>。
          只要曾经成功带出过一次，条目就会永久点亮，即使物品之后被出售或在行动中丢失。
        </p>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          ${statCard({ label: '图鉴收录', value: `${view.owned} / ${view.total}`, sub: `完成度 ${Math.round(view.ratio * 100)}%`, tone: view.owned ? 'delta' : 'rust' })}
          ${statCard({ label: '系列数量', value: `${view.series.length} 个`, sub: '后续将持续扩充', tone: 'sand' })}
          ${statCard({ label: '已点亮价值', value: fmt(view.series.reduce((sum, g) => sum + g.entries.filter((e) => e.discovered).reduce((v, e) => v + e.value, 0), 0)), sub: '按条目基准价值累计', tone: 'amber' })}
          ${statCard({ label: '待收录', value: `${view.total - view.owned} 项`, sub: '前往高难度行动搜集', tone: 'sky' })}
        </div>
        ${progressBar({ ratio: view.ratio, color: 'bg-delta', height: 'h-2' })}
      </div>
    </section>

    <div class="flex flex-wrap gap-2 mb-4">
      <button data-action="gl-series" data-id=""
        class="btn clip-tab px-3 py-1.5 text-[11px] border ${activeSeries ? 'border-line bg-panel2 text-sand/60 hover:text-sand' : 'border-delta bg-delta/15 text-delta'}">
        📚 全部系列
      </button>
      ${view.series.map((g) => `
        <button data-action="gl-series" data-id="${g.id}"
          class="btn clip-tab px-3 py-1.5 text-[11px] border ${activeSeries === g.id ? 'border-delta bg-delta/15 text-delta' : 'border-line bg-panel2 text-sand/60 hover:text-sand'}">
          ${g.icon} ${esc(g.name)} <span class="text-sand/40">${g.owned}/${g.total}</span>
        </button>
      `).join('')}
    </div>

    ${series.length ? series.map((group) => renderSeries(group, s)).join('') : emptyState('该系列暂无条目', '📭')}
  `;
}

function renderSeries(g, s) {
  return `
    <section class="mb-5">
      <header class="flex items-baseline justify-between gap-3 mb-2">
        <div class="min-w-0">
          <h3 class="text-xs text-delta tracking-wider">${g.icon} ${esc(g.name)}</h3>
          <p class="text-[10px] text-sand/40 mt-0.5">${esc(g.desc)}</p>
        </div>
        <span class="text-[10px] ${g.owned ? 'text-delta' : 'text-sand/35'} shrink-0">${g.owned} / ${g.total}</span>
      </header>
      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
        ${g.entries.map((e) => renderEntry(e, s)).join('')}
      </div>
    </section>
  `;
}

function renderEntry(e, s) {
  const on = e.discovered;
  const protectedFirst = e.refType === 'collectible' && protectedCollectibleCount(e.id, s) > 0;
  return `
    <button data-action="gl-entry" data-id="${e.id}"
      class="btn gl-card clip-tab text-left border ${on ? `bd-${e.rarity}` : 'border-dashed border-line'} ${on ? 'bg-panel2 gl-on' : 'bg-panel/60'} px-3 py-2.5">
      <span class="gl-card-icon ${on ? '' : 'gl-locked'}">${on ? entryIcon(e) : '❔'}</span>
      <span class="block text-xs ${on ? `rar-${e.rarity}` : 'text-sand/30'} truncate mt-1.5">
        ${on ? esc(e.name) : '未收录条目'}
      </span>
      <span class="block text-[10px] text-sand/35 mt-0.5 truncate">
        ${on ? `${esc(e.rarityName)} · ${esc(e.kindName || '')}` : '尚未获得'}
      </span>
      ${protectedFirst ? '<span class="protected-red-badge">🔒 首件保护</span>' : ''}
      <span class="flex items-center justify-between gap-2 mt-1.5">
        <span class="text-[10px] ${on ? 'text-delta' : 'text-sand/25'}">${on ? `价值 ${fmt(e.value)}` : '— —'}</span>
        ${on && e.count > 1 ? `<span class="text-[10px] text-amber-400">×${e.count}</span>` : ''}
      </span>
    </button>
  `;
}

function entryIcon(e) {
  if (e.refType === 'equipment') {
    return { 主武器: '🔫', 护甲: '🛡️', 头盔: '⛑️', 背包: '🎒', 战术道具: '💠' }[e.kindName] || '🔫';
  }
  return { 古物: '🏺', 情报: '🗂️', 勋章: '🎗️', 异常物: '☢️' }[e.kindName] || '🏆';
}

/* ============ 交互 ============ */

export function handleGallerySeries(id) {
  setGallerySeries(id);
  notify();
}

export function handleGalleryEntry(id) {
  const s = getState();
  const view = galleryView(s);
  const entry = view.series.flatMap((g) => g.entries).find((e) => e.id === id);
  if (!entry) {
    toast('该图鉴条目不存在', 'err');
    return;
  }
  if (!isDiscovered(id, s)) {
    openPanel({
      title: '未收录条目',
      bodyHtml: `
        <div class="op-body text-center">
          <p class="text-5xl opacity-30">❔</p>
          <p class="text-xs text-sand/55 mt-3">这件收藏尚未被小队带出过战区。</p>
          <p class="text-[11px] text-sand/40 mt-2 leading-relaxed">
            提高行动难度可以显著提升大红的出现概率，但撤离失败同样会让它彻底消失。
          </p>
        </div>
      `
    });
    return;
  }

  openPanel({
    title: `${entry.name} · 图鉴档案`,
    bodyHtml: `
      <div class="op-body">
        <div class="clip-tab bg-panel2 border bd-${entry.rarity} px-4 py-5 text-center gl-on">
          <p class="text-5xl">${entryIcon(entry)}</p>
          <p class="text-sm rar-${entry.rarity} mt-2">${esc(entry.name)}</p>
          <p class="text-[10px] text-sand/45 mt-1">${esc(entry.rarityName)} · ${esc(entry.kindName || '')}</p>
        </div>
        ${entry.desc ? `<p class="op-desc mt-3">${esc(entry.desc)}</p>` : ''}
        <div class="grid grid-cols-3 gap-2 mt-3">
          ${statCard({ label: '基准价值', value: fmt(entry.value), tone: 'delta' })}
          ${statCard({ label: '累计获得', value: `${entry.count} 次`, tone: 'amber' })}
          ${statCard({ label: '首次收录', value: entry.at ? fmtClock(entry.at) : '—', tone: 'sky' })}
        </div>
        ${entry.refType === 'equipment' ? `
          <div class="grid grid-cols-3 gap-2 mt-2">
            ${statCard({ label: '攻击', value: fmt(entry.atk), tone: 'rust' })}
            ${statCard({ label: '生命', value: fmt(entry.hp), tone: 'delta' })}
            ${statCard({ label: '防御', value: fmt(entry.def), tone: 'sky' })}
          </div>
        ` : ''}
      </div>
    `
  });
}
