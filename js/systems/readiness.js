/**
 * 战备评估系统
 * 战备 = 全部上阵干员所携装备价值总和（战备与装备价值为同一数值，单一口径对外）
 * 干员编成与技能升级绝不改变战备
 */

import { SLOTS, getTemplate, getBranch, DIFFICULTY_META, squadSize, scaledReadiness } from '../config/index.js';
import { getState } from '../core/state.js';
import { nonNeg } from '../core/utils.js';

/** 取某个装备实例的价值 */
export function itemValue(inst) {
  if (!inst) return 0;
  const tpl = getTemplate(inst.tplId);
  return tpl ? nonNeg(tpl.value, 0) : 0;
}

/** 由 uid 在仓库中查装备实例 */
export function findInstance(uidStr, s = getState()) {
  if (!uidStr) return null;
  return s.inventory.find((it) => it.uid === uidStr) || null;
}

/**
 * 按干员与槽位拆解战备贡献
 * @returns {Array<{opId, slots:Array}>}
 */
export function readinessByOperator(s = getState()) {
  const squad = (s?.operators?.squad || []).filter(Boolean);
  return squad.map((opId) => {
    const slotsState = s?.loadouts?.[opId] || {};
    const slots = SLOTS.map((slot) => {
      const instUid = slotsState[slot.id] || null;
      const inst = findInstance(instUid, s);
      const tpl = inst ? getTemplate(inst.tplId) : null;
      return {
        slot: slot.id,
        slotName: slot.name,
        icon: slot.icon,
        uid: inst ? inst.uid : null,
        tplId: tpl ? tpl.id : null,
        name: tpl ? tpl.name : null,
        rarity: tpl ? tpl.rarity : null,
        value: tpl ? nonNeg(tpl.value, 0) : 0
      };
    });
    return { opId, slots, total: slots.reduce((sum, r) => sum + r.value, 0) };
  });
}

/**
 * 指定干员的槽位拆解（未传 opId 时取首位上阵干员）
 * @returns {Array<{slot, slotName, icon, uid, tplId, name, rarity, value}>}
 */
export function readinessBreakdown(opId = null, s = getState()) {
  const target = opId || (s?.operators?.squad || []).filter(Boolean)[0] || null;
  const slotsState = (target && s?.loadouts?.[target]) || {};
  return SLOTS.map((slot) => {
    const instUid = slotsState[slot.id] || null;
    const inst = findInstance(instUid, s);
    const tpl = inst ? getTemplate(inst.tplId) : null;
    return {
      slot: slot.id,
      slotName: slot.name,
      icon: slot.icon,
      uid: inst ? inst.uid : null,
      tplId: tpl ? tpl.id : null,
      name: tpl ? tpl.name : null,
      rarity: tpl ? tpl.rarity : null,
      value: tpl ? nonNeg(tpl.value, 0) : 0
    };
  });
}

/** 当前战备（= 全部上阵干员所携装备价值总和） */
export function getReadiness(s = getState()) {
  return readinessByOperator(s).reduce((sum, row) => sum + row.total, 0);
}

/** 从任意 loadout 快照计算战备（支持按干员分组的嵌套快照） */
export function readinessOfLoadout(loadout, inventory) {
  if (!loadout) return 0;
  const list = Array.isArray(inventory) ? inventory : getState().inventory;
  const sumUid = (instUid) => {
    if (!instUid) return 0;
    return itemValue(list.find((it) => it.uid === instUid));
  };
  return Object.values(loadout).reduce((sum, val) => {
    if (val && typeof val === 'object') {
      return sum + Object.values(val).reduce((acc, u) => acc + sumUid(u), 0);
    }
    return sum + sumUid(val);
  }, 0);
}

/** 全队背包格数叠加；未装备背包不提供容量。 */
export function squadBagCapacity(s = getState()) {
  return (s?.operators?.squad || []).filter(Boolean).reduce((sum, opId) => {
    const uid = s?.loadouts?.[opId]?.bag;
    const inst = findInstance(uid, s);
    const tpl = inst ? getTemplate(inst.tplId) : null;
    return sum + (tpl?.slot === 'bag' ? nonNeg(tpl.capacity, 0) : 0);
  }, 0);
}

/**
 * 对比当前战备与所选行动门槛
 * @returns {{ ok, required, current, gap, hasThreshold, conclusion }}
 */
export function checkThreshold(mapId, difficulty, s = getState()) {
  const branch = getBranch(mapId, difficulty);
  const current = getReadiness(s);
  const size = squadSize(s?.operators?.squad);
  if (!branch) {
    return {
      ok: false, required: 0, base: 0, squadSize: size,
      current, gap: 0, hasThreshold: false, conclusion: '未选定行动'
    };
  }
  const base = nonNeg(branch.readiness, 0);
  const required = scaledReadiness(base, s?.operators?.squad);
  const hasThreshold = DIFFICULTY_META[difficulty]?.hasThreshold && required > 0;
  if (!hasThreshold) {
    return {
      ok: true, required: 0, base, squadSize: size,
      current, gap: 0, hasThreshold: false, conclusion: '无门槛'
    };
  }
  const ok = current >= required;
  return {
    ok,
    required,
    base,
    squadSize: size,
    current,
    gap: ok ? 0 : required - current,
    hasThreshold: true,
    conclusion: ok ? '战备价值达标' : '战备价值不足'
  };
}
