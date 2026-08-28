/**
 * 技能升级模块
 * 展示每个节点的当前等级、下一级效果与升级消耗（需求 9.7）
 */

import { getState } from '../../core/state.js';
import { fmt, esc } from '../../core/utils.js';
import { skillTreeView, upgradeSkill, totalSkillLevels } from '../../systems/skill.js';
import { toast, progressBar } from '../components.js';

export function renderSkillPanel() {
  const s = getState();
  const tree = skillTreeView(s);
  const total = totalSkillLevels(s);

  return `
    <div class="mb-4 clip-tab bg-panel2 border border-line px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
      <div>
        <p class="text-[10px] text-sand/45">已投入技能等级</p>
        <p class="text-lg text-delta leading-tight">${fmt(total)}</p>
      </div>
      <p class="text-[11px] text-sand/50 leading-relaxed max-w-2xl">
        技能增益为<span class="text-delta">账号级永久效果</span>，不会因撤离失败丢失或降级，也不会改变战备数值。
        它是装备之外唯一不会损失的成长线。
      </p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-4">
      ${tree.map(renderBranch).join('')}
    </div>
  `;
}

function renderBranch(branch) {
  return `
    <section class="clip-corner bg-panel border border-line">
      <header class="px-4 py-3 border-b border-line">
        <h3 class="text-sm text-delta tracking-wider">${branch.icon} ${esc(branch.name)}</h3>
        <p class="text-[10px] text-sand/40 mt-0.5">${esc(branch.desc)}</p>
      </header>
      <div class="p-3 space-y-3">
        ${branch.nodes.map(renderNode).join('')}
      </div>
    </section>
  `;
}

function renderNode(node) {
  return `
    <article class="clip-tab bg-panel2 border ${node.maxed ? 'border-delta/50' : 'border-line'} p-3">
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

      <button data-action="skill-up" data-id="${node.id}" ${node.maxed || !node.affordable ? 'disabled' : ''}
        class="btn w-full clip-tab text-[10px] py-1.5 mt-2 border ${node.maxed ? 'border-line text-sand/35' : 'border-amber-400/50 text-amber-400 hover:bg-amber-400/15'}">
        ${node.maxed ? '已达等级上限' : `升级 · ${fmt(node.cost)} 哈夫币${node.affordable ? '' : `（缺 ${fmt(node.shortfall)}）`}`}
      </button>
    </article>
  `;
}

export function handleUpgradeSkill(nodeId) {
  const r = upgradeSkill(nodeId);
  toast(r.msg, r.ok ? 'ok' : 'err');
}
