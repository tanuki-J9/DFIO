/**
 * 结算界面
 * 消费 state.lastSettlement：展示成败、失败原因、保住与损失清单、战备前后对比
 * 关闭后调用 dismissSettlement()，由 syncViewFromState 自动回到作战准备视图（需求 4.8）
 */

import { getMap, DIFFICULTY_META, RARITY_META } from '../config/index.js';
import { getState } from '../core/state.js';
import { fmt, fmtTime, esc } from '../core/utils.js';
import { lootKindLabel } from '../systems/loot.js';
import { dismissSettlement } from '../systems/settlement.js';
import { openPanel, emptyState } from './components.js';

let shownFor = null;
let closing = false;

/** 结算记录的唯一签名，避免同一份结算重复弹窗 */
function signature(r) {
  if (!r) return null;
  return [r.mapId, r.difficulty, r.success ? 1 : 0, r.reason || '-', r.duration, r.gainedValue, r.keptValue, r.lostValue].join('|');
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

function bodyHtml(r) {
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

  const stats = [
    statBlock({ label: '本轮搜集价值', value: fmt(r.gainedValue), sub: '含补给箱与击杀掉落', tone: 'text-sand' }),
    statBlock({ label: r.success ? '实际入库价值' : '保险箱保住价值', value: fmt(r.success ? r.gainedValue : r.keptValue), sub: r.success ? '全额入库' : '仅保险箱内物品', tone: 'text-emerald-400' }),
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

  return `
    <div class="flex flex-col gap-4">
      ${banner}
      ${emptyBoxHint}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5">${stats}</div>
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
    bodyHtml: bodyHtml(r),
    onMount: (bodyEl, close) => {
      const wrap = document.createElement('div');
      wrap.className = 'flex justify-end pt-4';
      wrap.innerHTML = `<button type="button" class="btn bg-delta text-ink font-bold px-6 py-2 clip-corner" data-settle-close="1">返回作战准备</button>`;
      bodyEl.appendChild(wrap);

      let done = false;
      const dismiss = () => {
        if (done) return;
        done = true;
        closing = true;
        dismissSettlement();
        closing = false;
      };

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

      wrap.querySelector('[data-settle-close]').addEventListener('click', () => {
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
