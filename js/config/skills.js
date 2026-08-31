/**
 * 永久技能配置：保留旧分支与节点 ID，并将节点归入基地设施。
 * 技能增益为账号级永久效果，不计入战备
 */

import { FACILITY } from './base.js';

/** Account-wide attack growth remains upgradeable, but its combat effect stops here. */
export const ACCOUNT_ATTACK_BONUS_CAP = 0.2;

export const SKILL_BRANCH = {
  COMBAT: 'combat',
  SURVIVAL: 'survival',
  SCAVENGE: 'scavenge',
  EXTRACT: 'extract'
};

export const SKILL_BRANCH_META = {
  [SKILL_BRANCH.COMBAT]: { id: SKILL_BRANCH.COMBAT, name: '战斗能力', icon: '⚔️', desc: '提升小队火力与交战效率' },
  [SKILL_BRANCH.SURVIVAL]: { id: SKILL_BRANCH.SURVIVAL, name: '生存能力', icon: '🛡️', desc: '提升小队生命与防御，降低被击溃概率' },
  [SKILL_BRANCH.SCAVENGE]: { id: SKILL_BRANCH.SCAVENGE, name: '搜刮效率', icon: '📦', desc: '加快搜刮速度并提升战利品产出' },
  [SKILL_BRANCH.EXTRACT]: { id: SKILL_BRANCH.EXTRACT, name: '撤离效率', icon: '🚁', desc: '缩短撤离读条并扩展保险箱容量' }
};

/**
 * effect 字段为「每级增量」，实际增益 = level * per
 * type 说明：
 *   atkPct / hpPct / defPct  战斗属性百分比
 *   fireRate                 交战结算频率百分比
 *   medicalHealPct           医疗战术道具治疗量百分比
 *   scavengeSpeed            搜刮耗时缩减百分比
 *   lootBonus                战利品价值百分比
 *   crateTier                补给箱稀有度权重偏移
 *   extractSpeed             撤离读条缩减百分比
 *   timeLimitBonus           行动时限延长百分比
 *   safeboxSlot              保险箱格数（整数）
 */
export const SKILL_NODES = [
  { id: 'sk_atk', branch: SKILL_BRANCH.COMBAT, facility: FACILITY.ARMORY, name: '火力压制', maxLevel: 10, cost: { base: 300, per: 240 }, effect: { type: 'atkPct', per: 0.05 }, unit: '%', desc: '小队攻击提升' },
  { id: 'sk_rate', branch: SKILL_BRANCH.COMBAT, facility: FACILITY.ARMORY, name: '速射训练', maxLevel: 8, cost: { base: 420, per: 320 }, effect: { type: 'fireRate', per: 0.06 }, unit: '%', desc: '交战伤害结算频率提升' },
  { id: 'sk_boss', branch: SKILL_BRANCH.COMBAT, facility: FACILITY.ARMORY, name: '斩首战术', maxLevel: 6, cost: { base: 900, per: 700 }, effect: { type: 'bossDmgPct', per: 0.08 }, unit: '%', desc: '对 Boss 伤害提升' },

  { id: 'sk_hp', branch: SKILL_BRANCH.SURVIVAL, facility: FACILITY.MEDICAL, name: '体能强化', maxLevel: 10, cost: { base: 300, per: 240 }, effect: { type: 'hpPct', per: 0.06 }, unit: '%', desc: '小队生命提升' },
  { id: 'sk_def', branch: SKILL_BRANCH.SURVIVAL, facility: FACILITY.ARMOR, name: '防护涂层', maxLevel: 8, cost: { base: 400, per: 300 }, effect: { type: 'defPct', per: 0.07 }, unit: '%', desc: '小队防御提升' },
  { id: 'sk_regen', branch: SKILL_BRANCH.SURVIVAL, facility: FACILITY.MEDICAL, name: '战术救护', maxLevel: 6, cost: { base: 800, per: 620 }, effect: { type: 'medicalHealPct', per: 0.03 }, unit: '%', desc: '医疗战术道具治疗量提升' },

  { id: 'sk_speed', branch: SKILL_BRANCH.SCAVENGE, facility: FACILITY.INTELLIGENCE, name: '快速搜索', maxLevel: 10, cost: { base: 280, per: 220 }, effect: { type: 'scavengeSpeed', per: 0.05 }, unit: '%', desc: '搜刮耗时缩减' },
  { id: 'sk_loot', branch: SKILL_BRANCH.SCAVENGE, facility: FACILITY.INTELLIGENCE, name: '战利品鉴定', maxLevel: 10, cost: { base: 360, per: 280 }, effect: { type: 'lootBonus', per: 0.05 }, unit: '%', desc: '战利品价值提升' },
  { id: 'sk_tier', branch: SKILL_BRANCH.SCAVENGE, facility: FACILITY.INTELLIGENCE, name: '情报网络', maxLevel: 5, cost: { base: 1200, per: 900 }, effect: { type: 'crateTier', per: 0.06 }, unit: '%', desc: '高稀有度补给箱出现权重提升' },

  { id: 'sk_ext', branch: SKILL_BRANCH.EXTRACT, facility: FACILITY.STORAGE, name: '撤离预案', maxLevel: 10, cost: { base: 340, per: 260 }, effect: { type: 'extractSpeed', per: 0.05 }, unit: '%', desc: '撤离读条时间缩减' },
  { id: 'sk_time', branch: SKILL_BRANCH.EXTRACT, facility: FACILITY.STORAGE, name: '后勤续航', maxLevel: 8, cost: { base: 520, per: 400 }, effect: { type: 'timeLimitBonus', per: 0.04 }, unit: '%', desc: '行动时限延长' },
  { id: 'sk_box', branch: SKILL_BRANCH.EXTRACT, facility: FACILITY.STORAGE, name: '保险箱扩容', maxLevel: 6, cost: { base: 1500, per: 1200 }, effect: { type: 'safeboxSlot', per: 1 }, unit: '格', desc: '保险箱容量增加' }
];

export function getSkillNode(nodeId) {
  return SKILL_NODES.find((n) => n.id === nodeId) || null;
}

export function skillUpgradeCost(node, currentLevel) {
  if (!node) return 0;
  return Math.round(node.cost.base + node.cost.per * currentLevel);
}
