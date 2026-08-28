/**
 * 弹药系统
 *
 * 规则：
 * 1. 弹药不是装备，不占装备槽，也不计入战备。它是按「发」计数的消耗资源，
 *    仓库以 { [ammoId]: 发数 } 记录，采购时每一发单独计价。
 * 2. 出发前选定一种弹药并指定携带发数，该发数即本轮的弹药储备。
 * 3. 子弹等级与目标防具等级比较决定伤害衰减：
 *    同级满额，低打高衰减（差距越大衰减越狠），高打低略有超额。
 * 4. 弹药打空后角色无法再使用枪械，只能靠技能造成伤害。
 *
 * 弹耗标定：每个交战回合固定消耗 ROUNDS_PER_TICK 发（与小队人数无关，
 * 全队共用一个弹药池），使「携带 240 发可支撑一整轮行动」成立。
 */

import {
  getAmmo, penetrationMul, clampGearLevel, templateLevel, AMMO_CARRY_MAX
} from '../config/index.js';
import { nonNegInt, nonNeg, clamp } from '../core/utils.js';

/**
 * 每个交战回合消耗的弹数
 * 结合交战 tick 间隔 0.8 秒与各地图的交战节点占比，
 * 一整轮行动的总弹耗约在 200-240 发区间，故 240 发可全程开火，
 * 180 发会在行动后段（约 85% 处）打空。
 */
export const ROUNDS_PER_TICK = 2;

/** 标定基准：一轮行动打满全程所需的携带发数 */
export const ROUNDS_FOR_FULL_RUN = 240;

/** 无弹药时技能可造成的伤害占正常枪械伤害的比例 */
export const SKILL_ONLY_RATIO = 0.25;

/** 仓库中某弹种的库存发数 */
export function ammoStock(ammoId, s) {
  if (!ammoId) return 0;
  return nonNegInt(s?.ammo?.[ammoId], 0);
}

/** 仓库中全部弹药的总发数 */
export function totalAmmoRounds(s) {
  return Object.values(s?.ammo || {}).reduce((sum, n) => sum + nonNegInt(n, 0), 0);
}

/** 增加某弹种的发数 */
export function addAmmoRounds(ammoId, rounds, s) {
  const tpl = getAmmo(ammoId);
  const n = nonNegInt(rounds, 0);
  if (!tpl || n <= 0 || !s) return 0;
  if (!s.ammo || typeof s.ammo !== 'object') s.ammo = {};
  s.ammo[ammoId] = nonNegInt(s.ammo[ammoId], 0) + n;
  return n;
}

/** 扣减某弹种的发数，返回实际扣减量 */
export function takeAmmoRounds(ammoId, rounds, s) {
  const have = ammoStock(ammoId, s);
  const used = Math.min(have, nonNegInt(rounds, 0));
  if (used <= 0) return 0;
  s.ammo[ammoId] = have - used;
  if (s.ammo[ammoId] <= 0) delete s.ammo[ammoId];
  return used;
}

/**
 * 校正出发配置：弹种必须存在，携带发数不得超过库存与携带上限
 * @returns {{ ammoId:string|null, rounds:number }}
 */
export function normalizeAmmoLoadout(s) {
  const want = s?.ammoLoadout || {};
  const tpl = getAmmo(want.ammoId);
  if (!tpl) return { ammoId: null, rounds: 0 };
  const stock = ammoStock(tpl.id, s);
  const rounds = Math.min(AMMO_CARRY_MAX, stock, nonNegInt(want.rounds, 0));
  return { ammoId: tpl.id, rounds };
}

/** 选定携带的弹种；切换时把携带发数夹到该弹种的库存内 */
export function selectAmmo(ammoId, s) {
  const tpl = getAmmo(ammoId);
  if (!tpl) return { ok: false, msg: '该弹种不存在' };
  if (s.run) return { ok: false, msg: '行动进行中，无法调整弹药' };
  if (!s.ammoLoadout || typeof s.ammoLoadout !== 'object') s.ammoLoadout = { ammoId: null, rounds: 0 };
  const stock = ammoStock(tpl.id, s);
  s.ammoLoadout.ammoId = tpl.id;
  s.ammoLoadout.rounds = Math.min(AMMO_CARRY_MAX, stock, nonNegInt(s.ammoLoadout.rounds, 0) || stock);
  return { ok: true, msg: `已选定 ${tpl.name}` };
}

/** 设置携带发数（夹取到库存与上限之间） */
export function setCarryRounds(rounds, s) {
  if (s.run) return { ok: false, msg: '行动进行中，无法调整弹药' };
  if (!s.ammoLoadout || typeof s.ammoLoadout !== 'object') s.ammoLoadout = { ammoId: null, rounds: 0 };
  const tpl = getAmmo(s.ammoLoadout.ammoId);
  if (!tpl) return { ok: false, msg: '请先选择弹种' };
  const stock = ammoStock(tpl.id, s);
  const n = Math.min(AMMO_CARRY_MAX, stock, Math.max(0, nonNegInt(rounds, 0)));
  s.ammoLoadout.rounds = n;
  return { ok: true, rounds: n, msg: `携带 ${n} 发 ${tpl.name}` };
}

/**
 * 出发时构造本轮弹药储备，并从仓库扣除携带的发数
 * @returns {{ rounds:number, maxRounds:number, level:number, ammoId:string|null, name:string, spent:number }}
 */
export function makeAmmoState(s) {
  const { ammoId, rounds } = normalizeAmmoLoadout(s);
  const tpl = ammoId ? getAmmo(ammoId) : null;
  if (!tpl || rounds <= 0) {
    return { rounds: 0, maxRounds: 0, level: 0, ammoId: null, name: '无弹药', spent: 0 };
  }
  // 携带即出库：带走的弹药从仓库中扣除，剩余的留在仓库里
  const taken = takeAmmoRounds(tpl.id, rounds, s);
  // 出库后同步下调待携带发数，避免下一轮显示超过库存
  s.ammoLoadout.rounds = Math.min(nonNegInt(s.ammoLoadout.rounds, 0), ammoStock(tpl.id, s));
  return {
    rounds: taken,
    maxRounds: taken,
    level: clampGearLevel(tpl.level),
    ammoId: tpl.id,
    name: tpl.name,
    spent: 0
  };
}

/** 预览出发时的弹药储备，不产生任何扣减（供出发前校验与简报使用） */
export function previewAmmoState(s) {
  const { ammoId, rounds } = normalizeAmmoLoadout(s);
  const tpl = ammoId ? getAmmo(ammoId) : null;
  if (!tpl || rounds <= 0) {
    return { rounds: 0, maxRounds: 0, level: 0, ammoId: null, name: '无弹药', spent: 0 };
  }
  return {
    rounds,
    maxRounds: rounds,
    level: clampGearLevel(tpl.level),
    ammoId: tpl.id,
    name: tpl.name,
    spent: 0
  };
}

/** 携带弹药提供的攻击加成（携带即生效，与发数无关） */
export function ammoAtkBonus(ammoId) {
  const tpl = getAmmo(ammoId);
  return tpl ? nonNeg(tpl.atk, 0) : 0;
}

/** 是否还有弹可打 */
export function hasAmmo(ammo) {
  return !!ammo && nonNegInt(ammo.rounds, 0) > 0;
}

/**
 * 消耗弹药
 * @returns {number} 实际消耗的弹数
 */
export function consumeAmmo(ammo, amount = ROUNDS_PER_TICK) {
  if (!ammo) return 0;
  const want = Math.max(0, Math.round(amount));
  const have = nonNegInt(ammo.rounds, 0);
  const used = Math.min(want, have);
  ammo.rounds = have - used;
  ammo.spent = nonNegInt(ammo.spent, 0) + used;
  return used;
}

/** 行动结束后把未打完的弹药退回仓库 */
export function returnAmmoToStock(ammo, s) {
  const left = nonNegInt(ammo?.rounds, 0);
  if (!ammo?.ammoId || left <= 0) return 0;
  return addAmmoRounds(ammo.ammoId, left, s);
}

/**
 * 取目标的有效防具等级
 * 敌人直接读 armorLevel 字段；我方小队取护甲与头盔的较高值
 */
export function targetArmorLevel(target) {
  if (!target) return 1;
  return clampGearLevel(target.armorLevel || 1);
}

/**
 * 我方小队的有效防护等级：所有上阵干员护甲 / 头盔中的最高等级
 * 用于敌方子弹对我方的穿透计算
 */
export function squadArmorLevel(loadoutSnapshot = {}, inventory = []) {
  const byUid = new Map(inventory.map((it) => [it.uid, it]));
  let best = 1;
  Object.values(loadoutSnapshot).forEach((slots) => {
    if (!slots) return;
    ['armor', 'helmet'].forEach((slot) => {
      const inst = byUid.get(slots[slot]);
      if (!inst) return;
      const lv = templateLevel(inst.tplId);
      if (lv > best) best = lv;
    });
  });
  return clampGearLevel(best);
}

/**
 * 计算一次射击的伤害倍率
 * 无弹药时返回技能倍率（枪械停火，仅技能可打）
 * @returns {{ mul:number, gun:boolean, pen:number }}
 */
export function shotMultiplier(ammo, armorLevel) {
  if (!hasAmmo(ammo)) {
    return { mul: SKILL_ONLY_RATIO, gun: false, pen: 0 };
  }
  const pen = penetrationMul(ammo.level, armorLevel);
  return { mul: pen, gun: true, pen };
}

/** 弹药条展示数据 */
export function ammoView(ammo) {
  const rounds = nonNegInt(ammo?.rounds, 0);
  const max = Math.max(1, nonNegInt(ammo?.maxRounds, 1));
  return {
    rounds,
    maxRounds: nonNegInt(ammo?.maxRounds, 0),
    spent: nonNegInt(ammo?.spent, 0),
    ratio: clamp(rounds / max, 0, 1),
    level: nonNegInt(ammo?.level, 0),
    name: ammo?.name || '无弹药',
    empty: rounds <= 0
  };
}

/** 穿透关系的可读描述，用于战报与面板提示 */
export function penetrationLabel(ammoLevel, armorLevel) {
  const a = clampGearLevel(ammoLevel);
  const d = clampGearLevel(armorLevel);
  const diff = a - d;
  if (diff === 0) return '同级穿透 · 满额伤害';
  if (diff > 0) return `高穿 +${diff} · 超额伤害`;
  const mul = penetrationMul(a, d);
  return `低穿 ${diff} · 伤害 ${Math.round(mul * 100)}%`;
}
