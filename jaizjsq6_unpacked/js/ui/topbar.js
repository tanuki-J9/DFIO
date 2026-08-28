/**
 * 常驻顶栏：货币与当前战备（需求 4.3）
 */

import { getState, VIEW } from '../core/state.js';
import { fmt } from '../core/utils.js';
import { getReadiness } from '../systems/readiness.js';
import { openPanel, delegate, emptyState } from './components.js';
import { readinessBreakdown } from '../systems/readiness.js';
import { RARITY_META } from '../config/index.js';

let root = null;
let lastSignature = '';

export function mountTopbar() {
  root = document.getElementById('topbar-root');
  if (!root) return;
  root.innerHTML = shell();
  bind();
  renderTopbar();
}

function shell() {
  return `
    <header class="sticky top-0 z-50 bg-panel/95 backdrop-blur border-b border-line">
      <div class="max-w-[1600px] mx-auto px-3 md:px-6 h-14 flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-delta text-lg">◤</span>
          <div class="min-w-0">
            <h1 class="text-sm text-delta tracking-[0.2em] leading-none truncate">三角洲放置</h1>
            <p class="text-[10px] text-sand/40 leading-none mt-1 truncate">DELTA IDLE OPERATIONS</p>
          </div>
        </div>
        <div id="topbar-info" class="flex items-center gap-2 md:gap-3 shrink-0"></div>
      </div>
    </header>
  `;
}

function bind() {
  delegate(root, {
    'readiness-detail': showReadinessDetail
  });
}

export function renderTopbar() {
  if (!root) return;
  const box = document.getElementById('topbar-info');
  if (!box) return;
  const s = getState();
  const readiness = getReadiness(s);
  const sig = `${s.currency.hafCoin}|${s.currency.deltaCoin}|${readiness}|${s.view}`;
  if (sig === lastSignature) return;
  lastSignature = sig;

  box.innerHTML = `
    <div class="clip-tab bg-panel2 border border-line px-2 md:px-3 py-1.5 flex items-center gap-1.5">
      <span class="text-amber-400 text-sm">🪙</span>
      <div class="leading-none">
        <p class="text-[9px] text-sand/40">哈夫币</p>
        <p class="text-xs text-amber-400">${fmt(s.currency.hafCoin)}</p>
      </div>
    </div>
    <div class="clip-tab bg-panel2 border border-line px-2 md:px-3 py-1.5 flex items-center gap-1.5">
      <span class="text-sky-400 text-sm">◈</span>
      <div class="leading-none">
        <p class="text-[9px] text-sand/40">三角币</p>
        <p class="text-xs text-sky-400">${fmt(s.currency.deltaCoin)}</p>
      </div>
    </div>
    <button data-action="readiness-detail"
      class="btn clip-tab bg-delta/10 border border-delta/50 px-2 md:px-3 py-1.5 flex items-center gap-1.5 hover:bg-delta/20"
      title="战备 = 所携装备价值总和，点击查看拆解">
      <span class="text-delta text-sm">🎖️</span>
      <div class="leading-none text-left">
        <p class="text-[9px] text-sand/40">战备 / 装备价值</p>
        <p class="text-xs text-delta">${fmt(readiness)}</p>
      </div>
    </button>
    <span class="hidden md:inline-flex clip-tab border border-line bg-panel2 px-2 py-1.5 text-[10px] text-sand/50">
      ${s.view === VIEW.EXPLORE ? '状态：行动中' : '状态：作战准备'}
    </span>
  `;
}

/** 战备详情：按槽位逐项拆解（需求 6.6） */
function showReadinessDetail() {
  const s = getState();
  const rows = readinessBreakdown(s);
  const total = rows.reduce((sum, r) => sum + r.value, 0);

  const body = `
    <p class="text-[11px] text-sand/55 leading-relaxed mb-3">
      战备与装备价值为<span class="text-delta">同一数值</span>：战备 = 小队所携全部装备的价值总和。
      干员编成与技能升级只影响实际战斗表现，不会改变战备。
    </p>
    <div class="space-y-2">
      ${rows.map((r) => `
        <div class="clip-tab bg-panel2 border ${r.tplId ? `bd-${r.rarity}` : 'border-line'} px-3 py-2 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-base">${r.icon}</span>
            <div class="min-w-0">
              <p class="text-[10px] text-sand/45">${r.slotName}</p>
              <p class="text-xs truncate ${r.tplId ? `rar-${r.rarity}` : 'text-sand/35'}">
                ${r.name || '未装备'}
                ${r.tplId ? `<span class="text-[10px] text-sand/40 ml-1">${RARITY_META[r.rarity].name}</span>` : ''}
              </p>
            </div>
          </div>
          <p class="text-sm ${r.value > 0 ? 'text-delta' : 'text-sand/30'} shrink-0">+${fmt(r.value)}</p>
        </div>
      `).join('')}
    </div>
    <div class="mt-4 pt-3 border-t border-line flex items-center justify-between">
      <span class="text-xs text-sand/60">战备合计</span>
      <span class="text-xl text-delta">${fmt(total)}</span>
    </div>
    ${total === 0 ? `<div class="mt-3">${emptyState('当前未装备任何装备，战备为 0，仅可进入普通行动', '🪖')}</div>` : ''}
  `;

  openPanel({ title: '战备拆解 · 按槽位', bodyHtml: body });
}
