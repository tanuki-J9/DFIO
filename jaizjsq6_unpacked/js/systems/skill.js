/**
 * 技能升级系统
 * 技能增益为账号级永久效果，不因撤离失败丢失，且绝不改变战备（需求 9.1 / 9.6）
 */

import { SKILL_NODES, SKILL_BRANCH_META, getSkillNode, skillUpgradeCost } from '../config/index.js';
import { getState, notify, spend } from '../core/state.js';
import { nonNegInt, nonNeg } from '../core/utils.js';

export function getSkillLevel(nodeId, s = getState()) {
  return nonNegInt(s.skills?.[nodeId], 0);
}

/** 分支分组后的节点视图 */
export function skillTreeView(s = getState()) {
  return Object.values(SKILL_BRANCH_META).map((branch) => ({
    ...branch,
    nodes: SKILL_NODES.filter((n) => n.branch === branch.id).map((n) => {
      const level = getSkillLevel(n.id, s);
      const maxed = level >= n.maxLevel;
      const cost = maxed ? 0 : skillUpgradeCost(n, level);
      const have = nonNeg(s.currency.hafCoin, 0);
      return {
        id: n.id,
        name: n.name,
        desc: n.desc,
        unit: n.unit,
        level,
        maxLevel: n.maxLevel,
        maxed,
        cost,
        affordable: !maxed && have >= cost,
        shortfall: maxed ? 0 : Math.max(0, Math.ceil(cost - have)),
        current: effectText(n, level),
        next: maxed ? null : effectText(n, level + 1)
      };
    })
  }));
}

function effectText(node, level) {
  const total = nonNeg(node.effect.per, 0) * nonNegInt(level, 0);
  if (node.unit === '格') return `+${Math.round(total)} 格`;
  return `+${(total * 100).toFixed(1)}%`;
}

/** 升级技能节点 */
export function upgradeSkill(nodeId, s = getState()) {
  const node = getSkillNode(nodeId);
  if (!node) return { ok: false, msg: '技能不存在' };
  const level = getSkillLevel(nodeId, s);
  if (level >= node.maxLevel) return { ok: false, msg: `${node.name} 已达等级上限` };

  const cost = skillUpgradeCost(node, level);
  const have = nonNeg(s.currency.hafCoin, 0);
  if (have < cost) {
    return { ok: false, msg: `哈夫币不足，还缺 ${Math.ceil(cost - have)}` };
  }
  if (!spend('hafCoin', cost)) return { ok: false, msg: '扣费失败' };

  s.skills[nodeId] = level + 1;
  notify();
  return { ok: true, msg: `${node.name} 提升至 Lv.${level + 1}`, level: level + 1 };
}

/**
 * 聚合全部技能增益
 * 返回统一的修正对象，供战斗、搜刮、撤离与时限逻辑消费
 */
export function skillBonuses(s = getState()) {
  const out = {
    atkPct: 0,
    hpPct: 0,
    defPct: 0,
    fireRate: 0,
    bossDmgPct: 0,
    regenPct: 0,
    scavengeSpeed: 0,
    lootBonus: 0,
    crateTier: 0,
    extractSpeed: 0,
    timeLimitBonus: 0,
    safeboxSlot: 0
  };
  SKILL_NODES.forEach((node) => {
    const level = getSkillLevel(node.id, s);
    if (level <= 0) return;
    const key = node.effect.type;
    if (!(key in out)) return;
    out[key] += nonNeg(node.effect.per, 0) * level;
  });
  out.safeboxSlot = Math.round(out.safeboxSlot);
  return out;
}

/** 已投入的技能总点数，用于面板概览 */
export function totalSkillLevels(s = getState()) {
  return SKILL_NODES.reduce((sum, n) => sum + getSkillLevel(n.id, s), 0);
}
