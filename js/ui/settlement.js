/**
 * 结算界面
 * 消费 state.lastSettlement：展示成败、失败原因、保住与损失清单、战备前后对比
 * 关闭后调用 dismissSettlement()，由 syncViewFromState 自动回到作战准备视图（需求 4.8）
 */

import {
  getMap, COMMANDER_XP_PER_LEVEL, DIFFICULTY_META, RARITY_META
} from '../config/index.js';
import { getState } from '../core/state.js';
import { fmt, fmtTime, esc } from '../core/utils.js';
import { lootKindLabel } from '../systems/loot.js';
import {
  dismissSettlement, resolveSettlementOverflow, settlementOverflowActionState
} from '../systems/settlement.js';
import { openPanel, emptyState, toast } from './components.js';

let shownFor = null;
let closing = false;

/** 结算记录的唯一签名，避免同一份结算重复弹窗 */
function signature(r) {
  if (!r) return null;
  const pending = (r.pendingItems || []).map((item) => item?.uid || '-').join(',');
  return [r.mapId, r.difficulty, r.success ? 1 : 0, r.reason || '-', r.duration, r.gainedValue, r.keptValue, r.lostValue, pending].join('|');
}

function rarityCls(rarity) {
  return RARITY_META[rarity] ? `rar-${rarity}` : 'text-sand';
}

/** 战利品/损失清单条目 */
function itemRow(it, tone) {
  const name = esc(it.name || lootKindLabel(it));
  const count = it.count > 1 ? `<span class="text-xs text-sand/60">×${fmt(it.count)}</span>` : '';
  const value = it.value > 0 ? `<span class="text-xs ${tone}">${fmt(it.value)}</span>` : '<span class="text-xs text-sand/40">—</span>';
  const cls = it.rarity ? rarityCls(it.rarity) : 'text-sand/90';
  return `
    <div class="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-panel2/60 border border-line/50">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-ink/60 text-sand/60 shrink-0">${esc(lootKindLabel(it))}</span>
        <span class="text-sm truncate ${cls}">${name}</span>
        ${count}
      </div>
      ${value}
    </div>`;
}

/** 清单区块（限量展示 + 溢出计数） */
function itemList(items, tone, emptyText) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return emptyState(emptyText, '—');
  const head = list.slice(0, 40).map((it) => itemRow(it, tone)).join('');
  const more = list.length > 40
    ? `<div class="text-center text-xs text-sand/50 pt-1">另有 ${fmt(list.length - 40)} 项…</div>`
    : '';
  return `<div class="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">${head}${more}</div>`;
}

function statBlock({ label, value, sub, tone }) {
  return `
    <div class="rounded-lg border border-line bg-panel2/70 px-3 py-2.5">
      <div class="text-[11px] text-sand/55">${esc(label)}</div>
      <div class="text-lg font-bold ${tone}">${value}</div>
      <div class="text-[11px] text-sand/45">${sub}</div>
    </div>`;
}

/** 战备前后对比条 */
function readinessCompare(r) {
  const before = Number(r.readinessBefore) || 0;
  const after = Number(r.readinessAfter) || 0;
  const delta = after - before;
  const tone = delta < 0 ? 'text-rust' : delta > 0 ? 'text-emerald-400' : 'text-sand/70';
  const arrow = delta < 0 ? '↓' : delta > 0 ? '↑' : '→';
  const ratio = before > 0 ? Math.max(0, Math.min(1, after / before)) : (after > 0 ? 1 : 0);
  const zeroHint = after === 0 && before > 0
    ? '<div class="text-[11px] text-rust/80 mt-1.5">所携装备已全部损失，战备归零。请前往「装备配置」重新配装后再次出发。</div>'
    : '';
  return `
    <div class="rounded-lg border border-line bg-panel2/70 px-3 py-3">
      <div class="flex items-center justify-between text-xs text-sand/60 mb-2">
        <span>战备变化（所携装备价值总和）</span>
        <span class="${tone} font-bold">${arrow} ${fmt(Math.abs(delta))}</span>
      </div>
      <div class="flex items-center gap-3">
        <div class="text-sm text-sand/70">出发前 <b class="text-sand">${fmt(before)}</b></div>
        <div class="flex-1 bar-track"><div class="bar-fill ${delta < 0 ? 'bg-rust' : 'bg-delta'}" style="width:${(ratio * 100).toFixed(1)}%"></div></div>
        <div class="text-sm text-sand/70">结算后 <b class="${tone}">${fmt(after)}</b></div>
      </div>
      ${zeroHint}
    </div>`;
}

/** 指挥官经验结算与下一级进度。 */
function commanderXpProgress(r) {
  const xp = r.commanderXp || {};
  const earned = Math.max(0, Number(xp.earned) || 0);
  const applied = Math.max(0, Number(xp.applied) || 0);
  const beforeLevel = Math.max(1, Number(xp.beforeLevel) || 1);
  const level = Math.max(1, Math.min(30, Number(xp.afterLevel) || beforeLevel));
  const totalXp = Math.max(0, Number(xp.totalXp) || 0);
  const spent = COMMANDER_XP_PER_LEVEL.slice(0, level - 1).reduce((sum, n) => sum + n, 0);
  const needed = level >= 30 ? 0 : COMMANDER_XP_PER_LEVEL[level - 1];
  const current = level >= 30 ? 0 : Math.max(0, totalXp - spent);
  const ratio = needed > 0 ? Math.max(0, Math.min(1, current / needed)) : 1;
  const levelUp = level > beforeLevel
    ? `<span class="text-emerald-400 font-bold">等级提升 ${beforeLevel} → ${level}</span>`
    : `<span>指挥官等级 ${level}</span>`;
  const capped = earned > applied ? ` · 满级上限仅计入 ${fmt(applied)}` : '';
  const progress = level >= 30 ? '已达到最高等级' : `${fmt(current)} / ${fmt(needed)}`;

  return `
    <div class="rounded-lg border border-delta/40 bg-delta/10 px-3 py-3">
      <div class="flex items-center justify-between gap-3 text-sm">
        <div>${levelUp}</div>
        <div class="text-delta font-bold">+${fmt(earned)} XP<span class="text-[11px] text-sand/50 font-normal">${capped}</span></div>
      </div>
      <div class="flex items-center gap-3 mt-2">
        <div class="flex-1 bar-track"><div class="bar-fill bg-delta" style="width:${(ratio * 100).toFixed(1)}%"></div></div>
        <div class="text-[11px] text-sand/60 shrink-0">${progress}</div>
      </div>
    </div>`;
}

export function renderSettlementBody(r) {
  const map = getMap(r.mapId);
  const diff = DIFFICULTY_META[r.difficulty];
  const mapName = map ? esc(map.name) : '未知区域';
  const diffName = diff ? esc(diff.name) : '未知难度';
  const c = r.counters || {};

  const banner = r.success
    ? `<div class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
         <div class="text-xl font-bold text-emerald-400">撤离成功</div>
         <div class="text-xs text-sand/60 mt-0.5">${mapName} · ${diffName} · 行动时长 ${fmtTime(r.duration)}</div>
       </div>`
    : `<div class="rounded-lg border border-rust/50 bg-rust/10 px-4 py-3">
         <div class="text-xl font-bold text-rust">行动失败 · ${esc(r.reasonText || '')}</div>
         <div class="text-xs text-sand/60 mt-0.5">${mapName} · ${diffName} · 行动时长 ${fmtTime(r.duration)}</div>
         <div class="text-[11px] text-sand/55 mt-1.5">撤离失败仅保留保险箱内的物品，其余携带物资与所携装备全部损失。</div>
       </div>`;

  const pending = Array.isArray(r.pendingItems) ? r.pendingItems.filter(Boolean) : [];
  const stats = [
    statBlock({ label: '本轮搜集价值', value: fmt(r.gainedValue), sub: '含补给箱与击杀掉落', tone: 'text-sand' }),
    statBlock({
      label: r.success ? '实际入库价值' : '保险箱保住价值',
      value: fmt(r.keptValue),
      sub: r.success && pending.length ? `${fmt(pending.length)} 项等待处理` : (r.success ? '已入仓库' : '仅保险箱内物品'),
      tone: 'text-emerald-400'
    }),
    statBlock({ label: '损失价值', value: fmt(r.lostValue), sub: r.success ? '无损失' : '含所携装备', tone: r.lostValue > 0 ? 'text-rust' : 'text-sand/60' }),
    statBlock({ label: '哈夫币收入', value: fmt(r.hafCoinGained), sub: r.success ? '已计入账户' : '失败不结算', tone: 'text-delta' })
  ].join('');

  const counters = [
    statBlock({ label: '开启补给箱', value: fmt(c.crates || 0), sub: '个', tone: 'text-sand' }),
    statBlock({ label: '击杀敌人', value: fmt(c.kills || 0), sub: `含首领 ${fmt(c.bossKills || 0)} 名`, tone: 'text-sand' }),
    statBlock({ label: '造成伤害', value: fmt(Math.round(c.damageDealt || 0)), sub: '点', tone: 'text-sand' }),
    statBlock({ label: '承受伤害', value: fmt(Math.round(c.damageTaken || 0)), sub: '点', tone: c.damageTaken > 0 ? 'text-rust' : 'text-sand/60' })
  ].join('');

  const emptyBoxHint = (!r.success && r.safeboxWasEmpty)
    ? `<div class="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
         保险箱为空，本轮没有任何物品被保住。出发前把关键物资放进保险箱，可在失败时保底。
       </div>`
    : '';

  const leftTitle = r.success ? '入库清单' : '保险箱保住';
  const leftItems = r.success ? r.gainedItems : r.keptItems;
  const leftEmpty = r.success ? '本轮没有搜集到任何物资' : '保险箱内没有物品';
  const overflow = pending.length ? `
    <section class="rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-3">
      <div class="flex items-center justify-between gap-3 mb-2">
        <div>
          <div class="text-sm font-bold text-amber-400">待处理撤离物资</div>
          <div class="text-[11px] text-sand/55 mt-0.5">仓库容量不足。每项必须入库、出售或丢弃后才能关闭结算。</div>
        </div>
        <span class="text-xs text-amber-400 shrink-0">${fmt(pending.length)} 项 · ${fmt(r.overflowValue)} 价值</span>
      </div>
      <div class="flex flex-col gap-1.5">
        ${pending.map((item) => {
          const actions = settlementOverflowActionState(item, pending, getState());
          const locked = actions.protectedRed && actions.consumableCount <= 0;
          const partial = actions.protectedRed && actions.protectedCount > 0 && actions.consumableCount > 0;
          const disabled = locked
            ? 'disabled aria-disabled="true" title="首件大红受收藏保护，必须入库"'
            : '';
          const protection = locked
            ? '<div class="text-[11px] text-amber-300 mt-1">🔒 首件大红保护 · 必须入库（满仓可保护入库）</div>'
            : partial
              ? `<div class="text-[11px] text-amber-300 mt-1">🔒 首件保留 · 可处理重复件 ${fmt(actions.consumableCount)}</div>`
              : '';
          return `
            <div class="flex flex-wrap items-center gap-2 px-2 py-2 bg-panel2/70 border border-line/60">
              <div class="min-w-0 grow">${itemRow(item, 'text-amber-400')}${protection}</div>
              <button type="button" data-settle-overflow="store" data-uid="${esc(item.uid)}"
                class="btn clip-tab px-2 py-1 text-[10px] border border-delta/50 text-delta">尝试入库</button>
              <button type="button" data-settle-overflow="sell" data-uid="${esc(item.uid)}" ${disabled}
                class="btn clip-tab px-2 py-1 text-[10px] border border-amber-400/50 text-amber-400 disabled:opacity-40">${partial ? '出售重复件' : '出售'}</button>
              <button type="button" data-settle-overflow="discard" data-uid="${esc(item.uid)}" ${disabled}
                class="btn clip-tab px-2 py-1 text-[10px] border border-rust/50 text-rust disabled:opacity-40">${partial ? '丢弃重复件' : '丢弃'}</button>
            </div>`;
        }).join('')}
      </div>
    </section>` : '';

  return `
    <div class="flex flex-col gap-4">
      ${banner}
      ${emptyBoxHint}
      ${overflow}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">${stats}</div>
      ${commanderXpProgress(r)}
      ${readinessCompare(r)}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">${counters}</div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          <div class="text-sm font-bold text-emerald-400 mb-2">${esc(leftTitle)}</div>
          ${itemList(leftItems, 'text-emerald-400', leftEmpty)}
        </div>
        <div>
          <div class="text-sm font-bold text-rust mb-2">损失清单</div>
          ${itemList(r.lostItems, 'text-rust', r.success ? '本轮无任何损失' : '没有可损失的物品')}
        </div>
      </div>
    </div>`;
}

/** 若存在未展示的结算记录，则弹出结算界面 */
export function maybeShowSettlement() {
  const s = getState();
  const r = s.lastSettlement;
  const sig = signature(r);

  if (!r) {
    shownFor = null;
    return;
  }
  if (sig === shownFor || closing) return;

  shownFor = sig;
  openPanel({
    title: r.success ? '行动结算 · 撤离成功' : '行动结算 · 行动失败',
    wide: true,
    bodyHtml: renderSettlementBody(r),
    onMount: (bodyEl, close) => {
      const wrap = document.createElement('div');
      wrap.className = 'flex justify-end pt-4';
      const hasPending = Array.isArray(r.pendingItems) && r.pendingItems.length > 0;
      wrap.innerHTML = hasPending
        ? '<span class="text-xs text-amber-400">请先处理全部待处理撤离物资</span>'
        : '<button type="button" class="btn bg-delta text-ink font-bold px-6 py-2 clip-corner" data-settle-close="1">返回作战准备</button>';
      bodyEl.appendChild(wrap);

      let done = false;
      const dismiss = () => {
        if (done) return;
        done = true;
        closing = true;
        const outcome = dismissSettlement();
        closing = false;
        if (!outcome.ok) {
          shownFor = null;
          setTimeout(maybeShowSettlement, 0);
        }
      };

      bodyEl.addEventListener('click', (event) => {
        const button = event.target.closest('[data-settle-overflow]');
        if (!button) return;
        const outcome = resolveSettlementOverflow(button.dataset.uid, button.dataset.settleOverflow);
        toast(outcome.msg, outcome.ok ? 'ok' : 'err');
        if (!outcome.ok) return;

        done = true;
        if (typeof close === 'function') close();
        shownFor = null;
        if (outcome.remaining > 0) setTimeout(maybeShowSettlement, 0);
        else dismissSettlement();
      });

      // 无论通过底部按钮、✕、遮罩点击还是 Esc 关闭，都必须消费掉本次结算记录
      const mask = bodyEl.closest('.modal-mask');
      if (mask) {
        const observer = new MutationObserver(() => {
          if (!mask.isConnected) {
            observer.disconnect();
            dismiss();
          }
        });
        if (mask.parentNode) observer.observe(mask.parentNode, { childList: true });
      }

      wrap.querySelector('[data-settle-close]')?.addEventListener('click', () => {
          if (typeof close === 'function') close();
          dismiss();
        });
    }
  });
}

/** 重置弹窗去重标记（重置进度时调用） */
export function resetSettlementUi() {
  shownFor = null;
  closing = false;
}
