/**
 * 探索视图信息面板
 * 展示剩余时限、本轮携带物资、战况统计、战报与撤离入口
 * 不渲染任何养成操作面板（需求 4.7 / 4.10）
 */

import { MAPS, DIFFICULTY_META } from '../../config/index.js';
import { getState, PHASE } from '../../core/state.js';
import { fmt, fmtTime, fmtClock, esc } from '../../core/utils.js';
import { remaining, isWarning, isRisky, extractProgress, extractDuration } from '../../systems/extraction.js';
import { carrySummary } from '../../systems/loot.js';
import { ammoView } from '../../systems/ammo.js';
import { nodeLabel } from '../../systems/march.js';
import { safeboxView } from '../../systems/safebox.js';
import { ensureSquadMembers, reviveRuntimeView } from '../../systems/operatorSkills.js';
import { progressBar, statCard, emptyState } from '../components.js';

const LOG_STYLE = {
  crate: { icon: '📦', cls: 'text-sky-400' },
  loot: { icon: '💎', cls: 'text-delta' },
  enemy: { icon: '⚔️', cls: 'text-amber-400' },
  boss: { icon: '💀', cls: 'text-fuchsia-400' },
  kill: { icon: '☠️', cls: 'text-sand' },
  extract: { icon: '🚁', cls: 'text-sky-400' },
  success: { icon: '✅', cls: 'text-delta' },
  fail: { icon: '❌', cls: 'text-rust' },
  skill: { icon: '✦', cls: 'text-fuchsia-400' },
  info: { icon: '·', cls: 'text-sand/60' }
};

/** 面板静态骨架，只渲染一次；动态部分按区块局部更新 */
export function panelSkeleton() {
  return `
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div class="xl:col-span-2 space-y-4">
        <div id="ex-header"></div>
        <div id="ex-stage-wrap"></div>
        <div id="ex-stats"></div>
      </div>
      <div class="space-y-4">
        <div id="ex-carry"></div>
        <div id="ex-log"></div>
      </div>
    </div>
  `;
}

/** 顶部：时限倒计时 + 撤离控制 */
export function renderHeader(s, now) {
  const run = s.run;
  if (!run) return '';
  const map = MAPS.find((m) => m.id === run.mapId);
  const meta = DIFFICULTY_META[run.difficulty];
  const left = remaining(s, now);
  const warn = isWarning(s, now);
  const ratio = run.timeLimit > 0 ? left / run.timeLimit : 0;
  const extracting = run.phase === PHASE.EXTRACTING;
  const exProg = extractProgress(s, now);
  const risky = isRisky(s, now);
  const members = ensureSquadMembers(run);
  const hpRatio = run.maxHp > 0 ? run.hp / run.maxHp : 0;
  const ammo = ammoView(run.ammo);
  const revive = reviveRuntimeView(run, now);

  return `
    <section class="clip-corner bg-panel border ${warn ? 'border-rust/60' : 'border-line'}">
      <div class="px-4 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-sm text-delta tracking-wider truncate">${esc(map?.name || '战区')} · ${esc(meta?.name || '')}</h2>
          <p class="text-[10px] text-sand/45 mt-0.5">${esc(nodeLabel(run))} · 节点 ${run.nodeIndex}</p>
        </div>
        <div class="text-right">
          <p class="text-[10px] text-sand/45">剩余行动时限</p>
          <p class="text-3xl leading-none ${warn ? 'timer-warn' : 'text-delta'}">${fmtTime(left)}</p>
        </div>
      </div>

      <div class="px-4 py-3 space-y-3">
        ${progressBar({
          ratio,
          color: warn ? 'bg-rust' : (ratio < 0.5 ? 'bg-amber-400' : 'bg-delta'),
          height: 'h-2.5',
          label: `<span>时限进度</span><span>${fmtTime(left)} / ${fmtTime(run.timeLimit)}</span>`
        })}
        ${progressBar({
          ratio: hpRatio,
          color: hpRatio > 0.5 ? 'bg-delta' : (hpRatio > 0.25 ? 'bg-amber-400' : 'bg-rust'),
          height: 'h-2.5',
          label: `<span>小队生命</span><span>${fmt(run.hp)} / ${fmt(run.maxHp)}</span>`
        })}

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          ${members.map((m) => {
            const ratio = m.maxHp > 0 ? m.hp / m.maxHp : 0;
            return `
              <div class="clip-tab bg-panel2 border ${m.downed ? 'border-rust/60' : 'border-line'} px-2.5 py-2">
                <div class="flex items-center justify-between gap-2 text-[10px]">
                  <span class="${m.downed ? 'text-rust' : 'text-sand/70'} truncate">${esc(m.name)}</span>
                  <span class="${m.downed ? 'text-rust' : 'text-sand/45'}">${m.downed ? '倒地' : `${fmt(m.hp)}/${fmt(m.maxHp)}`}</span>
                </div>
                <div class="h-1.5 bg-black/30 mt-1.5 overflow-hidden">
                  <div class="h-full ${m.downed ? 'bg-rust' : (ratio > 0.5 ? 'bg-delta' : (ratio > 0.25 ? 'bg-amber-400' : 'bg-rust'))}" style="width:${Math.max(0, Math.min(100, ratio * 100)).toFixed(1)}%"></div>
                </div>
              </div>`;
          }).join('')}
        </div>

        ${revive ? `
          <div class="clip-tab bg-fuchsia-400/10 border border-fuchsia-400/40 px-3 py-2">
            <div class="flex items-center justify-between text-[10px] gap-2">
              <span class="text-fuchsia-400">🚑 ${esc(revive.sourceName)} → ${esc(revive.targetName)} · ${revive.kind === 'ultimate' ? '大招复活' : '战地救助'}</span>
              <span class="text-sand/60">${revive.remaining.toFixed(1)}s</span>
            </div>
            <div class="h-1.5 bg-black/30 mt-1.5 overflow-hidden"><div class="h-full bg-fuchsia-400" style="width:${(revive.progress * 100).toFixed(1)}%"></div></div>
          </div>
        ` : ''}

        ${progressBar({
          ratio: ammo.ratio,
          color: ammo.empty ? 'bg-rust' : (ammo.ratio > 0.3 ? 'bg-sky-400' : 'bg-amber-400'),
          height: 'h-2',
          label: `<span>弹药 · ${esc(ammo.name)}${ammo.level ? ` · ${ammo.level} 级` : ''}</span><span>${fmt(ammo.rounds)} / ${fmt(ammo.maxRounds)} 发 · 已打 ${fmt(ammo.spent)}</span>`
        })}

        ${ammo.empty ? `
          <div class="clip-tab bg-rust/15 border border-rust/50 px-3 py-2">
            <p class="text-[11px] text-rust">🔫 弹药耗尽：枪械已停火，小队只能依靠技能造成伤害（伤害大幅下降）</p>
          </div>
        ` : ''}

        ${warn ? `
          <div class="clip-tab bg-rust/15 border border-rust/50 px-3 py-2">
            <p class="text-[11px] text-rust">⚠ 紧急预警：剩余时间已不足，请尽快撤离，否则将判定撤离超时并按失败结算！</p>
          </div>
        ` : ''}

        ${extracting ? `
          <div class="clip-tab bg-sky-400/10 border border-sky-400/50 px-3 py-2.5 space-y-2">
            <p class="text-[11px] text-sky-400">🚁 撤离中 · 读条期间不再触发新节点，但仍可能被敌人打断</p>
            ${progressBar({ ratio: exProg, color: 'bg-sky-400', height: 'h-2' })}
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] text-sand/50">${(exProg * 100).toFixed(0)}% · 共 ${extractDuration(s).toFixed(1)} 秒</span>
              <button data-action="cancel-extract"
                class="btn clip-tab text-[10px] px-3 py-1.5 border border-rust/50 text-rust hover:bg-rust/15">取消撤离</button>
            </div>
          </div>
        ` : `
          <button data-action="start-extract"
            class="btn w-full clip-tab py-3 text-sm border ${risky ? 'border-rust bg-rust/15 text-rust' : 'border-delta bg-delta/15 text-delta hover:bg-delta/25'}">
            🚁 呼叫撤离${risky ? '（时间不足，极可能超时）' : ` · 读条 ${extractDuration(s).toFixed(1)}s`}
          </button>
        `}
      </div>
    </section>
  `;
}

/** 战况统计 */
export function renderStats(s) {
  const run = s.run;
  if (!run) return '';
  const c = run.counters;
  return `
    <section class="clip-corner bg-panel border border-line">
      <header class="px-4 py-2.5 border-b border-line">
        <h3 class="text-xs text-delta tracking-wider">战况统计</h3>
      </header>
      <div class="p-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        ${statCard({ label: '击杀', value: fmt(c.kills), tone: 'rust' })}
        ${statCard({ label: 'BOSS', value: fmt(c.bossKills), tone: 'amber' })}
        ${statCard({ label: '搜刮箱数', value: fmt(c.crates), tone: 'sky' })}
        ${statCard({ label: '造成伤害', value: fmt(c.damageDealt), tone: 'sand' })}
        ${statCard({ label: '承受伤害', value: fmt(c.damageTaken), tone: 'rust' })}
        ${statCard({ label: '推进节点', value: fmt(run.nodeIndex), tone: 'delta' })}
      </div>
      <div class="px-4 py-2 border-t border-line">
        <p class="text-[10px] text-sand/40">
          行动进行中无法调整干员编成、装备配置与技能升级，请先完成本轮结算后再返回作战准备视图操作。
        </p>
      </div>
    </section>
  `;
}

/** 本轮携带物资 */
export function renderCarry(s) {
  const run = s.run;
  if (!run) return '';
  const sum = carrySummary(run);
  const box = safeboxView(s);

  return `
    <section class="clip-corner bg-panel border border-delta/40">
      <header class="px-4 py-2.5 border-b border-line flex items-center justify-between">
        <h3 class="text-xs text-delta tracking-wider">本轮携带物资</h3>
        <span class="text-[10px] text-sand/45">${run.carry.items.length} 项</span>
      </header>
      <div class="px-4 py-3">
        <p class="text-[10px] text-sand/45">累计价值（撤离决策依据）</p>
        <p class="text-3xl text-delta leading-tight">${fmt(sum.total)}</p>
        <div class="grid grid-cols-4 gap-2 mt-3 text-[10px]">
          <span class="text-sand/50">哈夫币 <span class="text-amber-400">${fmt(sum.hafCoin)}</span></span>
          <span class="text-sand/50">材料 <span class="text-sky-400">${sum.materials.length}</span></span>
          <span class="text-sand/50">装备 <span class="text-fuchsia-400">${sum.equipment.length}</span></span>
          <span class="text-sand/50">弹药 <span class="text-delta">${fmt(sum.ammo.reduce((n, it) => n + (it.count || 0), 0))}</span> 发</span>
        </div>
        <div class="clip-tab bg-panel2 border ${box.used ? 'border-delta/40' : 'border-rust/40'} px-3 py-2 mt-3">
          <p class="text-[10px] ${box.used ? 'text-delta' : 'text-rust'}">
            🔒 保险箱 ${box.used}/${box.capacity} · 保底价值 ${fmt(box.totalValue)}
          </p>
          <p class="text-[10px] text-sand/45 mt-0.5">
            ${box.used
              ? '撤离失败时仅保留保险箱内物品，本轮携带物资与所携装备将全部损失。'
              : '保险箱为空，撤离失败将导致本轮全损且所携装备一并丢失。'}
          </p>
        </div>
      </div>
      <div class="px-3 pb-3 max-h-64 overflow-y-auto">
        ${run.carry.items.length ? `
          <div class="space-y-1.5">
            ${[...run.carry.items].reverse().slice(0, 40).map((it) => `
              <div class="clip-tab bg-panel2 border bd-${it.rarity} px-2.5 py-1.5 flex items-center justify-between gap-2">
                <span class="text-[11px] rar-${it.rarity} truncate">${esc(it.name)}${it.count > 1 ? ` ×${it.count}` : ''}</span>
                <span class="text-[10px] text-delta shrink-0">${fmt(it.value)}</span>
              </div>
            `).join('')}
          </div>
        ` : emptyState('尚无战利品，搜刮补给箱或击杀敌人以获取', '🎒')}
      </div>
    </section>
  `;
}

/** 战报 */
export function renderLog(s) {
  const run = s.run;
  if (!run) return '';
  return `
    <section class="clip-corner bg-panel border border-line">
      <header class="px-4 py-2.5 border-b border-line flex items-center justify-between">
        <h3 class="text-xs text-delta tracking-wider">实时战报</h3>
        <span class="text-[10px] text-sand/40">${run.logs.length} 条</span>
      </header>
      <div class="p-3 max-h-80 overflow-y-auto">
        ${run.logs.length ? `
          <div class="space-y-1">
            ${run.logs.map((log) => {
              const st = LOG_STYLE[log.type] || LOG_STYLE.info;
              return `
                <div class="log-item flex items-start gap-2 text-[11px] leading-relaxed">
                  <span class="shrink-0 text-sand/30">${fmtClock(log.at)}</span>
                  <span class="shrink-0">${st.icon}</span>
                  <span class="${st.cls} min-w-0 break-all">${esc(log.text)}</span>
                </div>
              `;
            }).join('')}
          </div>
        ` : emptyState('等待战报…', '📡')}
      </div>
    </section>
  `;
}
