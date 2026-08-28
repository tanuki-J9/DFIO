/**
 * 干员小队系统
 * 编成上限 3 名、禁止重复上阵、哈夫币升级、定位协同
 * 干员与技能均不影响战备（需求 6.4 / 7.x）
 */

import {
  OPERATORS, ROLE_META, RARITY_META, SYNERGY,
  SQUAD_LIMIT, OPERATOR_MAX_LEVEL, OPERATOR_UPGRADE_COST, OPERATOR_LEVEL_GROWTH,
  ROLE_PASSIVE, SKILL_KIND_META, ROLE_PASSIVE_EFFECTS, ROLE,
  getOperator
} from '../config/index.js';
import { getState, notify, spend } from '../core/state.js';
import { nonNegInt, nonNeg } from '../core/utils.js';
import { loadoutStats } from './equipment.js';
import { skillBonuses } from './skill.js';

export { SQUAD_LIMIT };

export function isUnlocked(opId, s = getState()) {
  const cfg = getOperator(opId);
  if (!cfg) return false;
  // 未放出的干员永远不可用，即使存档里残留了解锁记录
  if (cfg.comingSoon) return false;
  // 隐藏角色仅作展示，永不可解锁
  if (cfg.hidden) return false;
  return !!cfg.unlocked || s.operators.unlocked.includes(opId);
}

export function getLevel(opId, s = getState()) {
  return Math.max(1, nonNegInt(s.operators.levels?.[opId], 1));
}

/** 按等级计算干员实际属性 */
export function operatorStats(opId, s = getState()) {
  const cfg = getOperator(opId);
  if (!cfg) return { atk: 0, hp: 0, def: 0 };
  const level = getLevel(opId, s);
  const mul = 1 + OPERATOR_LEVEL_GROWTH * (level - 1);
  return {
    atk: Math.round(nonNeg(cfg.atk, 0) * mul),
    hp: Math.round(nonNeg(cfg.hp, 0) * mul),
    def: Math.round(nonNeg(cfg.def, 0) * mul)
  };
}

export function upgradeCost(opId, s = getState()) {
  const level = getLevel(opId, s);
  return Math.round(OPERATOR_UPGRADE_COST.base + OPERATOR_UPGRADE_COST.perLevel * level);
}

/** 干员列表视图数据 */
export function operatorListView(s = getState()) {
  return OPERATORS.map((cfg) => {
    const comingSoon = !!cfg.comingSoon;
    const hidden = !!cfg.hidden;
    const unlocked = !comingSoon && !hidden && isUnlocked(cfg.id, s);
    const level = getLevel(cfg.id, s);
    const stats = operatorStats(cfg.id, s);
    const maxed = level >= OPERATOR_MAX_LEVEL;
    const cost = maxed ? 0 : upgradeCost(cfg.id, s);
    const have = nonNeg(s.currency.hafCoin, 0);
    const passive = ROLE_PASSIVE[cfg.role] || null;
    const skills = (Array.isArray(cfg.skills) ? cfg.skills : []).map((sk) => ({
      ...sk,
      kindTag: SKILL_KIND_META[sk.kind]?.tag || '技能',
      kindTone: SKILL_KIND_META[sk.kind]?.tone || 'sky'
    }));
    return {
      id: cfg.id,
      name: cfg.name,
      quote: cfg.quote,
      role: cfg.role,
      roleName: ROLE_META[cfg.role].name,
      roleFullName: ROLE_META[cfg.role].fullName,
      roleIcon: ROLE_META[cfg.role].icon,
      roleMark: ROLE_META[cfg.role].mark,
      roleBias: ROLE_META[cfg.role].bias,
      rarity: cfg.rarity,
      rarityName: RARITY_META[cfg.rarity].name,
      palette: cfg.palette || null,
      comingSoon,
      hidden,
      title: cfg.title || '',
      intro: cfg.intro || '',
      hiddenNote: cfg.hiddenNote || '',
      passive,
      skills,
      unlocked,
      recruitCost: nonNeg(cfg.cost, 0),
      canRecruit: !comingSoon && !hidden && !unlocked && have >= nonNeg(cfg.cost, 0),
      level,
      maxLevel: OPERATOR_MAX_LEVEL,
      maxed,
      upgradeCost: cost,
      canUpgrade: unlocked && !maxed && have >= cost,
      stats,
      inSquad: s.operators.squad.includes(cfg.id)
    };
  });
}

function locked(s) {
  return !!s.run;
}

/** 招募干员 */
export function recruit(opId, s = getState()) {
  const cfg = getOperator(opId);
  if (!cfg) return { ok: false, msg: '干员不存在' };
  if (cfg.comingSoon) return { ok: false, msg: '该干员尚未放出' };
  if (cfg.hidden) return { ok: false, msg: `${cfg.name} 为隐藏角色，无法解锁` };
  if (isUnlocked(opId, s)) return { ok: false, msg: '该干员已在编' };
  const cost = nonNeg(cfg.cost, 0);
  const have = nonNeg(s.currency.hafCoin, 0);
  if (have < cost) return { ok: false, msg: `哈夫币不足，还缺 ${Math.ceil(cost - have)}` };
  if (!spend('hafCoin', cost)) return { ok: false, msg: '扣费失败' };
  s.operators.unlocked.push(opId);
  s.operators.levels[opId] = 1;
  notify();
  return { ok: true, msg: `${cfg.name} 已加入指挥部` };
}

/** 升级干员 */
export function upgradeOperator(opId, s = getState()) {
  const cfg = getOperator(opId);
  if (!cfg) return { ok: false, msg: '干员不存在' };
  if (!isUnlocked(opId, s)) return { ok: false, msg: '请先招募该干员' };
  const level = getLevel(opId, s);
  if (level >= OPERATOR_MAX_LEVEL) return { ok: false, msg: `${cfg.name} 已达等级上限` };
  const cost = upgradeCost(opId, s);
  const have = nonNeg(s.currency.hafCoin, 0);
  if (have < cost) return { ok: false, msg: `哈夫币不足，还缺 ${Math.ceil(cost - have)}` };
  if (!spend('hafCoin', cost)) return { ok: false, msg: '扣费失败' };
  s.operators.levels[opId] = level + 1;
  notify();
  return { ok: true, msg: `${cfg.name} 提升至 Lv.${level + 1}` };
}

/** 上阵 / 下阵切换 */
export function toggleSquad(opId, s = getState()) {
  if (locked(s)) return { ok: false, msg: '行动进行中，无法调整编成' };
  const cfg = getOperator(opId);
  if (!cfg) return { ok: false, msg: '干员不存在' };
  if (cfg.comingSoon) return { ok: false, msg: `${cfg.name === '未放出' ? '该干员' : cfg.name} 尚未放出，无法选定` };
  if (cfg.hidden) return { ok: false, msg: `${cfg.name} 为隐藏角色，无法编成` };
  if (!isUnlocked(opId, s)) return { ok: false, msg: '请先招募该干员' };

  const idx = s.operators.squad.indexOf(opId);
  if (idx >= 0) {
    s.operators.squad.splice(idx, 1);
    notify();
    return { ok: true, msg: `${cfg.name} 已下阵` };
  }
  if (s.operators.squad.length >= SQUAD_LIMIT) {
    return { ok: false, msg: `小队席位已满，最多上阵 ${SQUAD_LIMIT} 名干员` };
  }
  s.operators.squad.push(opId);
  notify();
  return { ok: true, msg: `${cfg.name} 已上阵` };
}

/**
 * 计算激活的定位协同
 * @returns {Array<{role, name, count, text, effect}>}
 */
export function activeSynergies(s = getState()) {
  const counts = {};
  s.operators.squad.forEach((id) => {
    const cfg = getOperator(id);
    if (!cfg) return;
    counts[cfg.role] = (counts[cfg.role] || 0) + 1;
  });
  const out = [];
  Object.entries(counts).forEach(([role, count]) => {
    if (count < 2) return;
    const conf = SYNERGY[role];
    if (!conf) return;
    const effect = count >= 3 ? conf.at3 : conf.at2;
    out.push({
      role,
      roleName: ROLE_META[role].name,
      name: conf.name,
      count,
      text: conf.text,
      effect
    });
  });
  return out;
}

/**
 * 聚合小队最终战斗属性
 * 来源：干员基础属性 + 装备加成 → 定位协同 → 技能增益
 * 该结果只影响战斗表现，绝不参与战备计算
 */
export function squadCombatStats(s = getState()) {
  const base = { atk: 0, hp: 0, def: 0 };
  s.operators.squad.forEach((id) => {
    const st = operatorStats(id, s);
    base.atk += st.atk;
    base.hp += st.hp;
    base.def += st.def;
  });

  const gear = loadoutStats(s);
  base.atk += gear.atk;
  base.hp += gear.hp;
  base.def += gear.def;

  const syn = { atk: 0, hp: 0, def: 0, scavenge: 0, extract: 0 };
  activeSynergies(s).forEach((entry) => {
    Object.entries(entry.effect).forEach(([k, v]) => {
      if (k in syn) syn[k] += nonNeg(v, 0);
    });
  });

  const sk = skillBonuses(s);

  // 定位基础被动：只按实际上阵人数叠加，不计入战备。
  const roleCount = { [ROLE.ASSAULT]: 0, [ROLE.SUPPORT]: 0, [ROLE.ENGINEER]: 0, [ROLE.SCOUT]: 0 };
  s.operators.squad.forEach((id) => {
    const role = getOperator(id)?.role;
    if (role in roleCount) roleCount[role] += 1;
  });
  const passive = {
    crateTierBonus: roleCount[ROLE.SCOUT] * nonNeg(ROLE_PASSIVE_EFFECTS[ROLE.SCOUT]?.crateTierBonus, 0),
    marchSpeed: roleCount[ROLE.ASSAULT] * nonNeg(ROLE_PASSIVE_EFFECTS[ROLE.ASSAULT]?.marchSpeed, 0),
    reviveSpeed: roleCount[ROLE.SUPPORT] * nonNeg(ROLE_PASSIVE_EFFECTS[ROLE.SUPPORT]?.reviveSpeed, 0)
  };

  const atk = Math.round(base.atk * (1 + syn.atk) * (1 + sk.atkPct));
  const hp = Math.round(base.hp * (1 + syn.hp) * (1 + sk.hpPct));
  const def = Math.round(base.def * (1 + syn.def) * (1 + sk.defPct));

  return {
    base,
    atk: Math.max(1, atk),
    hp: Math.max(1, hp),
    def: Math.max(0, def),
    synergy: syn,
    skill: sk,
    /** 效率类修正：搜刮与撤离 */
    scavengeSpeed: syn.scavenge + sk.scavengeSpeed,
    extractSpeed: syn.extract + sk.extractSpeed,
    fireRate: sk.fireRate,
    bossDmgPct: sk.bossDmgPct,
    regenPct: sk.regenPct,
    lootBonus: sk.lootBonus,
    crateTierBonus: sk.crateTier + passive.crateTierBonus,
    marchSpeed: passive.marchSpeed,
    reviveSpeed: passive.reviveSpeed,
    rolePassive: passive,
    timeLimitBonus: sk.timeLimitBonus
  };
}

/** 出发时的干员快照，供演出层渲染像素小人 */
export function makeSquadSnapshot(s = getState()) {
  return s.operators.squad.map((id) => {
    const cfg = getOperator(id);
    const st = operatorStats(id, s);
    return {
      id,
      name: cfg?.name || id,
      role: cfg?.role || 'assault',
      rarity: cfg?.rarity || 'common',
      level: getLevel(id, s),
      atk: st.atk,
      hp: st.hp,
      def: st.def
    };
  });
}
