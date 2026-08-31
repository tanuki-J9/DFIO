/** 特勤处 · 基地：设施总览、升级路线与事务入口。 */

import {
  COMMANDER_XP_PER_LEVEL,
  FACILITY,
  FACILITY_ORDER,
  getCollectible,
  getMaterial,
  sourceMapsOf
} from '../../config/index.js';
import { getState } from '../../core/state.js';
import { esc, fmt } from '../../core/utils.js';
import { facilityUpgradeView, upgradeFacility } from '../../systems/base.js';
import { skillNodesForFacility, upgradeSkill } from '../../systems/skill.js';
import { confirmDialog, delegate, openPanel, progressBar, toast } from '../components.js';
import { itemArt } from '../itemArt.js';

function commanderProgress(s) {
  const level = Math.max(1, Math.min(30, Number(s?.commander?.level) || 1));
  const current = Math.max(0, Number(s?.commander?.currentXp) || 0);
  const required = level >= 30 ? 0 : COMMANDER_XP_PER_LEVEL[level - 1];
  return { level, current, required, ratio: required ? current / required : 1 };
}

function gateText(view) {
  if (view.maxed) return '设施已达最高等级';
  if (view.gate.type === 'commander') {
    return view.gate.ok
      ? `指挥官等级满足：Lv.${view.gate.current} / ${view.gate.required}`
      : `升级条件未满足：指挥官达到 ${view.gate.required} 级`;
  }
  return view.gate.ok
    ? `指挥中心等级满足：Lv.${view.gate.current} / ${view.gate.required}`
    : `升级条件未满足：指挥中心达到 ${view.gate.required} 级`;
}

function sourceText(id) {
  if (getMaterial(id)) return '来源：全战区行动 · 装备配置商店';
  const maps = sourceMapsOf(id).map((source) => source.name);
  return maps.length ? `来源：${maps.join('、')}` : '来源：战区行动';
}

function itemTemplate(id) {
  return getMaterial(id) || getCollectible(id) || { id, name: id, rarity: 'common' };
}

function selectedCounts(selections) {
  const counts = {};
  (selections?.poolPicks || []).forEach((pick) => {
    if (pick?.tplId && Number.isInteger(pick.count) && pick.count > 0) {
      counts[pick.tplId] = (counts[pick.tplId] || 0) + pick.count;
    }
  });
  return counts;
}

function poolRowsForRender(view, selections) {
  if (Array.isArray(selections?.poolRows)) {
    return view.pools.map((_, index) => ({ ...(selections.poolRows[index] || {}) }));
  }
  const remaining = selectedCounts(selections);
  return view.pools.map((pool) => {
    const row = {};
    let room = pool.required;
    pool.ids.forEach((id) => {
      const count = Math.min(room, remaining[id] || 0);
      if (count > 0) row[id] = count;
      remaining[id] = Math.max(0, (remaining[id] || 0) - count);
      room -= count;
    });
    return row;
  });
}

function picksFromRows(rows) {
  const counts = {};
  rows.forEach((row) => Object.entries(row).forEach(([tplId, count]) => {
    if (count > 0) counts[tplId] = (counts[tplId] || 0) + count;
  }));
  return {
    poolPicks: Object.entries(counts).map(([tplId, count]) => ({ tplId, count })),
    poolRows: rows.map((row) => ({ ...row }))
  };
}

function poolsComplete(view, rows) {
  return view.pools.every((pool, index) => Object.values(rows[index] || {})
    .reduce((sum, count) => sum + count, 0) === pool.required);
}

export function renderBasePanel(s = getState()) {
  const commander = commanderProgress(s);
  const commandCenter = facilityUpgradeView(FACILITY.COMMAND_CENTER, s);
  return `
    <section class="base-commander clip-corner bg-panel border border-delta/50 overflow-hidden mb-4">
      <div class="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
        <div class="flex items-center gap-3 shrink-0">
          <span class="base-rank">${commander.level}</span>
          <div>
            <p class="text-[10px] text-sand/45 tracking-wider">指挥官等级</p>
            <p class="text-lg text-delta">Lv.${commander.level}</p>
          </div>
        </div>
        <div class="grow min-w-0">
          <div class="flex justify-between gap-3 text-[10px] mb-1">
            <span class="text-sand/45">${commander.required ? '下一等级进度' : '已达最高等级'}</span>
            <span class="text-delta">${commander.required ? `${fmt(commander.current)} / ${fmt(commander.required)} XP` : 'MAX'}</span>
          </div>
          ${progressBar({ ratio: commander.ratio, color: 'bg-delta', height: 'h-2' })}
          <p class="text-[10px] text-sand/35 mt-1.5">行动中的搜刮与战斗会积累指挥官经验；指挥官等级决定指挥中心的升级许可。</p>
        </div>
      </div>
      ${commandCenter?.level >= 10 ? `
        <div data-command-center-badge class="border-t border-amber-400/35 bg-amber-400/10 px-4 py-2.5 flex items-center justify-between gap-3">
          <span class="text-xs text-amber-400">🏅 指挥中心满级徽章</span>
          <span class="text-[11px] text-amber-400 tracking-[0.2em]">永恒建设</span>
        </div>
      ` : ''}
    </section>

    <section class="clip-corner bg-panel border border-line overflow-hidden">
      <header class="px-4 py-2.5 border-b border-line flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-base">🏗️</span>
          <h3 class="text-xs text-delta tracking-[0.2em]">基地设施 · SPECIAL OPERATIONS BASE</h3>
        </div>
        <span class="text-[10px] text-sand/40 shrink-0">7 座设施 · 最高 Lv.10</span>
      </header>
      <div class="base-grid p-3">
        ${FACILITY_ORDER.map((id) => {
          const view = facilityUpgradeView(id, s);
          const locked = !view.maxed && !view.gate.ok;
          return `
            <button data-action="base-facility" data-id="${id}"
              class="btn base-card clip-tab text-left border ${locked ? 'border-rust/45 locked-stripe' : 'border-line'} bg-panel2 px-3 py-3">
              <span class="flex items-start justify-between gap-3">
                <span class="base-facility-icon">${esc(view.icon)}</span>
                <span class="text-right">
                  <span class="block text-[9px] text-sand/35">当前等级</span>
                  <span class="block text-base ${view.maxed ? 'text-amber-400' : 'text-delta'}">Lv.${view.level}</span>
                </span>
              </span>
              <span class="block text-xs text-sand mt-2">${esc(view.name)}</span>
              <span data-facility-effects="${id}" class="block text-[10px] text-delta/80 mt-1 leading-relaxed">${esc(view.currentEffect)}</span>
              <span class="block text-[10px] ${locked ? 'text-rust' : 'text-sand/40'} mt-1 truncate">${esc(gateText(view))}</span>
              <span class="block text-[10px] text-delta/70 mt-2">查看升级路线 →</span>
            </button>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderRoute(view) {
  return `
    <div class="base-route" aria-label="设施等级路线">
      ${Array.from({ length: view.maxLevel }, (_, index) => {
        const level = index + 1;
        const state = level < view.level ? 'done' : level === view.level ? 'current' : 'future';
        return `<span data-route-level="${level}" class="base-route-node is-${state}" title="Lv.${level}">${level}</span>`;
      }).join('')}
    </div>
  `;
}

function renderPool(pool, index, row, allRows, inventoryMissing = 0) {
  const selected = Object.values(row).reduce((sum, count) => sum + count, 0);
  const totalSelected = (id) => allRows.reduce((sum, selectedRow) => sum + (selectedRow[id] || 0), 0);
  return `
    <section class="clip-tab border ${inventoryMissing ? 'border-rust/50' : selected === pool.required ? 'border-delta/50' : 'border-line'} bg-panel2 px-3 py-3">
      <div class="flex items-center justify-between gap-3 mb-2">
        <p class="text-[11px] text-sand">可选物资池 ${index + 1}</p>
        <div class="text-right shrink-0">
          <p class="text-[10px] ${selected === pool.required ? 'text-delta' : 'text-rust'}">已选 ${selected} / ${pool.required}</p>
          ${inventoryMissing ? `<p class="text-[9px] text-rust">库存不足 · 还缺 ${inventoryMissing}</p>` : ''}
        </div>
      </div>
      <div class="space-y-2">
        ${pool.ids.map((id) => {
          const tpl = itemTemplate(id);
          const owned = pool.available[id] || 0;
          const count = row[id] || 0;
          const rowFull = selected >= pool.required;
          const inventoryFull = totalSelected(id) >= owned;
          return `
            <div class="base-cost-row">
              ${itemArt({ ...tpl, kind: 'equipment' }, { size: 'sm', showLevel: false })}
              <div class="grow min-w-0">
                <p class="text-[11px] rar-${tpl.rarity} truncate">${esc(tpl.name)}</p>
                <p class="text-[9px] text-sand/35 truncate">${esc(sourceText(id))}</p>
              </div>
              <span class="text-[10px] text-sand/45 shrink-0">库存 ${owned}</span>
              <div class="base-stepper shrink-0">
                <button data-action="base-pool-dec" data-pool="${index}" data-id="${id}" ${count <= 0 ? 'disabled' : ''} aria-label="减少 ${esc(tpl.name)}">−</button>
                <span>${count}</span>
                <button data-action="base-pool-inc" data-pool="${index}" data-id="${id}" ${rowFull || inventoryFull ? 'disabled' : ''} aria-label="增加 ${esc(tpl.name)}">＋</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderFacilitySkills(facilityId, s) {
  const nodes = skillNodesForFacility(facilityId, s);
  if (!nodes.length) return '';
  return `
    <section class="mt-3 clip-corner border border-line bg-panel overflow-hidden">
      <header class="px-4 py-3 border-b border-line">
        <h4 class="text-xs text-delta tracking-wider">永久技能</h4>
        <p class="text-[10px] text-sand/40 mt-0.5">旧技能等级与升级费用原样保留；永久生效且不计入战备。</p>
      </header>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3">
        ${nodes.map((node) => `
          <article data-skill-id="${node.id}" class="clip-tab bg-panel2 border ${node.maxed ? 'border-delta/50' : 'border-line'} p-3">
            <div class="flex items-start justify-between gap-2 mb-2">
              <div class="min-w-0">
                <p class="text-xs ${node.maxed ? 'text-delta' : 'text-sand'} truncate">${esc(node.name)}</p>
                <p class="text-[10px] text-sand/40 mt-0.5">${esc(node.desc)}</p>
              </div>
              <span class="shrink-0 text-[10px] ${node.maxed ? 'text-delta' : 'text-sand/50'}">Lv.${node.level}/${node.maxLevel}</span>
            </div>
            ${progressBar({ ratio: node.level / node.maxLevel, color: node.maxed ? 'bg-delta' : 'bg-delta/60', height: 'h-1.5' })}
            <div class="grid grid-cols-2 gap-2 mt-2 text-[10px]">
              <span class="text-sand/45">当前 <span class="text-delta">${esc(node.current)}</span></span>
              <span class="text-sand/45">下级 <span class="${node.maxed ? 'text-sand/30' : 'text-amber-400'}">${node.maxed ? '已满级' : esc(node.next)}</span></span>
            </div>
            ${node.capReached ? `<p class="text-[9px] text-amber-400 mt-2">${esc(node.capText)} 已生效；后续等级与费用仍按旧存档规则保留。</p>` : ''}
            <button data-action="base-skill-up" data-id="${node.id}" ${node.maxed || !node.affordable ? 'disabled' : ''}
              class="btn w-full clip-tab text-[10px] py-1.5 mt-2 border ${node.maxed ? 'border-line text-sand/35' : 'border-amber-400/50 text-amber-400 hover:bg-amber-400/15'}">
              ${node.maxed ? '已达等级上限' : `升级 · ${fmt(node.cost)} 哈夫币${node.affordable ? '' : `（缺 ${fmt(node.shortfall)}）`}`}
            </button>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

export function renderFacilityDetail(id, selections = { poolPicks: [] }, s = getState()) {
  const view = facilityUpgradeView(id, s);
  if (!view) return '<p class="text-xs text-rust">设施不存在</p>';
  const rows = poolRowsForRender(view, selections);
  const pickReady = poolsComplete(view, rows);
  const poolMissing = Number(view.poolMissing) || 0;
  const materialMissing = view.collectibles.some((cost) => cost.missing) || poolMissing;
  const upgradeStatus = !view.gate.ok
    ? 'gate-locked'
    : materialMissing
      ? 'material-missing'
      : view.currency.missing
        ? 'currency-missing'
        : !pickReady ? 'selection-incomplete' : 'ready';
  const upgradeTone = upgradeStatus === 'ready'
    ? 'border-delta bg-delta/15 text-delta'
    : upgradeStatus === 'currency-missing'
      ? 'border-amber-400/50 bg-amber-400/10 text-amber-400'
      : upgradeStatus === 'material-missing'
        ? 'border-rust/50 bg-rust/10 text-rust'
        : 'border-line bg-panel2 text-sand/35';

  return `
    <div class="base-detail">
      <section class="base-detail-head clip-tab border border-line bg-panel2 px-4 py-3">
        <div class="flex items-center gap-3">
          <span class="base-facility-icon">${esc(view.icon)}</span>
          <div class="grow min-w-0">
            <p class="text-sm text-sand">${esc(view.name)}</p>
            <p class="text-[10px] ${view.gate.ok || view.maxed ? 'text-delta' : 'text-rust'} mt-0.5">${esc(gateText(view))}</p>
          </div>
          <span class="text-lg ${view.maxed ? 'text-amber-400' : 'text-delta'}">Lv.${view.level}</span>
        </div>
        ${renderRoute(view)}
        <section class="mt-3 border-t border-line pt-3">
          <h4 class="text-[10px] text-delta tracking-wider mb-2">核心效果 · 当前 → 下级</h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            ${view.effects.map((effect) => `
              <div class="clip-tab border border-line bg-panel px-2.5 py-2 flex items-center justify-between gap-3">
                <span class="text-[10px] text-sand/45">${esc(effect.label)}</span>
                <span class="text-[10px] text-right">
                  <span class="text-delta">${esc(effect.value)}</span>
                  <span class="text-sand/30 mx-1">→</span>
                  <span class="${effect.next ? 'text-amber-400' : 'text-sand/30'}">${effect.next ? esc(effect.next) : '最终效果'}</span>
                </span>
              </div>
            `).join('')}
          </div>
        </section>
      </section>

      ${view.maxed ? `
        <div class="clip-tab border border-amber-400/40 bg-amber-400/10 text-center text-xs text-amber-400 px-4 py-6 mt-3">
          ${id === FACILITY.COMMAND_CENTER
            ? '🏅 指挥中心满级徽章 · 永恒建设'
            : '设施已完成全部升级路线'}
        </div>
      ` : `
        <section class="mt-3">
          <div class="flex items-center justify-between gap-3 mb-2">
            <h4 class="text-xs text-delta tracking-wider">升级至 Lv.${view.targetLevel}</h4>
            <span class="text-[10px] text-sand/40">升级由基地事务系统统一校验并扣除</span>
          </div>
          <div data-cost-kind="currency" class="base-cost-row clip-tab border ${view.currency.missing ? 'border-amber-400/50' : 'border-delta/40'} bg-panel2 px-3 py-3 mb-2">
            <span class="text-base">🪙</span>
            <div class="grow">
              <p class="text-[11px] text-sand">哈夫币</p>
              <p class="text-[9px] text-sand/35">库存 ${fmt(view.currency.available)}</p>
            </div>
            <span class="text-xs ${view.currency.missing ? 'text-amber-400' : 'text-delta'}">需要 ${fmt(view.currency.required)}${view.currency.missing ? ` · 还缺 ${view.currency.missing.toLocaleString('zh-CN')}` : ' · 已满足'}</span>
          </div>
          <div class="space-y-2">
            ${view.pools.map((pool, index) => renderPool(pool, index, rows[index], rows, view.poolMissingByRow?.[index] || 0)).join('')}
            ${view.collectibles.map((cost) => {
              const tpl = itemTemplate(cost.id);
              const maps = sourceText(cost.id);
              return `
                <div class="base-cost-row clip-tab border ${cost.missing ? 'border-rust/50' : 'bd-red'} bg-panel2 px-3 py-3">
                  ${itemArt({ ...tpl, kind: 'equipment' }, { size: 'sm', showLevel: false })}
                  <div class="grow min-w-0">
                    <p class="text-[11px] rar-red truncate">${esc(tpl.name)}</p>
                    <p class="text-[9px] text-sand/35 truncate">${esc(maps)}</p>
                  </div>
                  <div class="text-right shrink-0">
                    <p class="text-[10px] ${cost.missing ? 'text-rust' : 'text-delta'}">需要 ${cost.required} · 可消耗 ${cost.consumable}</p>
                    <p class="text-[9px] text-rust">🔒 首件保护 ${cost.protected}${cost.missing ? ` · 还缺 ${cost.missing}` : ''}</p>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          <p class="text-[10px] text-sand/35 leading-relaxed mt-3">蓝紫材料可从全战区行动获得，也可在装备配置商店采购；金色与红色收藏品只在标注战区掉落。大红首件永久保护，升级仅能消耗重复件。</p>
          <button data-action="base-upgrade" data-id="${id}" data-upgrade-status="${upgradeStatus}"
            ${!view.canUpgrade || !pickReady ? 'disabled' : ''}
            class="btn w-full clip-corner mt-3 py-3 text-xs border ${upgradeTone}">
            ${!view.gate.ok ? '升级条件未满足' : materialMissing ? '升级资源不足' : view.currency.missing ? '哈夫币不足' : !pickReady ? '请精确选择升级物资' : `确认升级至 Lv.${view.targetLevel}`}
          </button>
        </section>
      `}
      ${renderFacilitySkills(id, s)}
    </div>
  `;
}

export async function handleFacilityUpgrade(id, selections, options = {}) {
  const state = options.state || getState();
  const ask = options.confirm || confirmDialog;
  const apply = options.apply || upgradeFacility;
  const toastResult = options.toastResult || ((msg, type) => toast(msg, type));
  const view = facilityUpgradeView(id, state);
  if (!view || view.maxed) {
    const result = { ok: false, msg: view ? `${view.name} 已达等级上限` : '设施不存在' };
    toastResult(result.msg, 'err');
    return result;
  }

  const confirmed = await ask({
    title: `升级${view.name}至 Lv.${view.targetLevel}`,
    body: `将由基地系统校验并扣除 ${fmt(view.currency.required)} 哈夫币和已选物资。是否继续？`,
    okText: '确认升级'
  });
  if (!confirmed) return { ok: false, cancelled: true, stage: 'upgrade' };

  if (view.targetLevel >= 9 && view.collectibles.length) {
    const reds = view.collectibles.map((cost) => {
      const tpl = getCollectible(cost.id);
      return `${tpl?.name || cost.id} ×${cost.required}`;
    }).join('、');
    const permanent = await ask({
      title: '永久消耗大红 · 二次确认',
      body: `本次升级将永久消耗重复大红：${esc(reds)}。首件保护副本不会被消耗，此操作无法撤销。`,
      okText: '确认永久消耗',
      danger: true
    });
    if (!permanent) return { ok: false, cancelled: true, stage: 'permanent-red' };
  }

  const result = apply(id, { poolPicks: selections?.poolPicks || [] }, state);
  toastResult(result.msg, result.ok ? 'ok' : 'err');
  return result;
}

export function openFacilityDetail(id) {
  const initialView = facilityUpgradeView(id);
  if (!initialView) {
    toast('设施不存在', 'err');
    return null;
  }
  let rows = initialView.pools.map(() => ({}));
  const handle = openPanel({
    title: `${initialView.name} · 升级路线`,
    wide: true,
    bodyHtml: renderFacilityDetail(id, picksFromRows(rows)),
    onMount: (body, close) => {
      const repaint = () => { body.innerHTML = renderFacilityDetail(id, picksFromRows(rows)); };
      delegate(body, {
        'base-pool-inc': ({ pool, id: tplId }) => {
          const view = facilityUpgradeView(id);
          const index = Number(pool);
          const target = view?.pools[index];
          if (!target || !target.ids.includes(tplId)) return;
          const rowCount = Object.values(rows[index]).reduce((sum, count) => sum + count, 0);
          const totalForItem = rows.reduce((sum, row) => sum + (row[tplId] || 0), 0);
          if (rowCount >= target.required || totalForItem >= (target.available[tplId] || 0)) return;
          rows[index][tplId] = (rows[index][tplId] || 0) + 1;
          repaint();
        },
        'base-pool-dec': ({ pool, id: tplId }) => {
          const index = Number(pool);
          if (!rows[index]?.[tplId]) return;
          rows[index][tplId] -= 1;
          if (rows[index][tplId] <= 0) delete rows[index][tplId];
          repaint();
        },
        'base-upgrade': async () => {
          const result = await handleFacilityUpgrade(id, picksFromRows(rows));
          if (result.ok) close();
          else repaint();
        },
        'base-skill-up': ({ id: nodeId }) => {
          const result = upgradeSkill(nodeId);
          toast(result.msg, result.ok ? 'ok' : 'err');
          repaint();
        }
      });
    }
  });
  return handle;
}
