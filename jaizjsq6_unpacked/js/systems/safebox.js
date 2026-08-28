/**
 * 保险箱系统
 * 有限格数、可通过技能扩容；撤离失败时仅保留其中物品（需求 2.2 / 2.3 / 2.4）
 */

import { SAFEBOX_BASE_SLOTS, getTemplate, getMaterial, RARITY_META, RARITY } from '../config/index.js';
import { getState, notify } from '../core/state.js';
import { nonNeg, nonNegInt, uid } from '../core/utils.js';
import { skillBonuses } from './skill.js';
import { LOOT_KIND } from './loot.js';

/** 当前保险箱容量 = 基础格数 + 技能扩容 */
export function capacity(s = getState()) {
  const bonus = nonNegInt(skillBonuses(s).safeboxSlot, 0);
  return SAFEBOX_BASE_SLOTS + bonus;
}

export function usedSlots(s = getState()) {
  return Array.isArray(s.safebox.items) ? s.safebox.items.length : 0;
}

export function isFull(s = getState()) {
  return usedSlots(s) >= capacity(s);
}

export function isEmpty(s = getState()) {
  return usedSlots(s) === 0;
}

/** 保险箱内物品总价值 */
export function safeboxValue(s = getState()) {
  return (s.safebox.items || []).reduce((sum, it) => sum + nonNeg(it.value, 0), 0);
}

/** 全部干员携带中的装备 uid（本地实现，避免与 equipment.js 循环依赖） */
function equippedUidSet(s) {
  const set = new Set();
  Object.values(s.loadouts || {}).forEach((slots) => {
    if (!slots || typeof slots !== 'object') return;
    Object.values(slots).forEach((u) => { if (u) set.add(u); });
  });
  return set;
}

/**
 * 出发前可放入保险箱的候选物品
 * 来源：仓库中的未携带装备、库存材料、以及一笔可指定额度的哈夫币
 */
export function candidates(s = getState()) {
  const equippedUids = equippedUidSet(s);
  const stored = new Set((s.safebox.items || []).map((it) => it.srcUid).filter(Boolean));

  const equipment = s.inventory
    .filter((it) => !equippedUids.has(it.uid) && !stored.has(it.uid))
    .map((it) => {
      const tpl = getTemplate(it.tplId);
      return {
        srcUid: it.uid,
        kind: LOOT_KIND.EQUIPMENT,
        tplId: it.tplId,
        name: tpl.name,
        rarity: tpl.rarity,
        rarityName: RARITY_META[tpl.rarity].name,
        count: 1,
        value: nonNeg(tpl.value, 0)
      };
    })
    .sort((a, b) => b.value - a.value);

  const materials = Object.entries(s.materials || {})
    .filter(([, n]) => nonNegInt(n, 0) > 0)
    .map(([matId, n]) => {
      const mat = getMaterial(matId);
      if (!mat) return null;
      const inBox = (s.safebox.items || [])
        .filter((it) => it.kind === LOOT_KIND.MATERIAL && it.tplId === matId)
        .reduce((sum, it) => sum + nonNegInt(it.count, 0), 0);
      const available = nonNegInt(n, 0) - inBox;
      if (available <= 0) return null;
      return {
        srcUid: null,
        kind: LOOT_KIND.MATERIAL,
        tplId: matId,
        name: mat.name,
        rarity: mat.rarity,
        rarityName: RARITY_META[mat.rarity].name,
        count: available,
        value: nonNeg(mat.value, 0) * available
      };
    })
    .filter(Boolean);

  return { equipment, materials };
}

/** 放入装备（占 1 格） */
export function depositEquipment(instUid, s = getState()) {
  if (s.run) return { ok: false, msg: '行动进行中，无法调整保险箱' };
  if (isFull(s)) return { ok: false, msg: `保险箱容量已满（${usedSlots(s)}/${capacity(s)}）` };
  const inst = s.inventory.find((it) => it.uid === instUid);
  if (!inst) return { ok: false, msg: '装备不存在' };
  const equipped = equippedUidSet(s).has(instUid);
  if (equipped) return { ok: false, msg: '携带中的装备不可放入保险箱' };
  const already = (s.safebox.items || []).some((it) => it.srcUid === instUid);
  if (already) return { ok: false, msg: '该装备已在保险箱中' };

  const tpl = getTemplate(inst.tplId);
  s.safebox.items.push({
    uid: uid('sb'),
    srcUid: inst.uid,
    kind: LOOT_KIND.EQUIPMENT,
    tplId: inst.tplId,
    name: tpl.name,
    rarity: tpl.rarity,
    count: 1,
    value: nonNeg(tpl.value, 0)
  });
  notify();
  return { ok: true, msg: `${tpl.name} 已存入保险箱` };
}

/** 放入材料（可指定数量，占 1 格） */
export function depositMaterial(matId, count = 1, s = getState()) {
  if (s.run) return { ok: false, msg: '行动进行中，无法调整保险箱' };
  if (isFull(s)) return { ok: false, msg: `保险箱容量已满（${usedSlots(s)}/${capacity(s)}）` };
  const mat = getMaterial(matId);
  if (!mat) return { ok: false, msg: '材料不存在' };
  const have = nonNegInt(s.materials[matId], 0);
  const inBox = (s.safebox.items || [])
    .filter((it) => it.kind === LOOT_KIND.MATERIAL && it.tplId === matId)
    .reduce((sum, it) => sum + nonNegInt(it.count, 0), 0);
  const n = Math.min(Math.max(1, nonNegInt(count, 1)), have - inBox);
  if (n <= 0) return { ok: false, msg: '可存入数量不足' };

  s.safebox.items.push({
    uid: uid('sb'),
    srcUid: null,
    kind: LOOT_KIND.MATERIAL,
    tplId: matId,
    name: mat.name,
    rarity: mat.rarity,
    count: n,
    value: nonNeg(mat.value, 0) * n
  });
  notify();
  return { ok: true, msg: `${mat.name} ×${n} 已存入保险箱` };
}

/** 存入哈夫币（占 1 格） */
export function depositHafCoin(amount, s = getState()) {
  if (s.run) return { ok: false, msg: '行动进行中，无法调整保险箱' };
  if (isFull(s)) return { ok: false, msg: `保险箱容量已满（${usedSlots(s)}/${capacity(s)}）` };
  const have = nonNeg(s.currency.hafCoin, 0);
  const n = Math.min(Math.max(1, nonNegInt(amount, 0)), have);
  if (n <= 0) return { ok: false, msg: '哈夫币不足' };

  s.currency.hafCoin = have - n;
  s.safebox.items.push({
    uid: uid('sb'),
    srcUid: null,
    kind: LOOT_KIND.HAF,
    tplId: 'hafCoin',
    name: '哈夫币',
    rarity: RARITY.COMMON,
    count: n,
    value: n
  });
  notify();
  return { ok: true, msg: `${n} 哈夫币已存入保险箱` };
}

/** 取出保险箱物品（哈夫币退回货币栏，其余仅解除占格） */
export function withdraw(boxUid, s = getState()) {
  if (s.run) return { ok: false, msg: '行动进行中，无法调整保险箱' };
  const idx = (s.safebox.items || []).findIndex((it) => it.uid === boxUid);
  if (idx < 0) return { ok: false, msg: '保险箱中没有该物品' };
  const item = s.safebox.items[idx];
  if (item.kind === LOOT_KIND.HAF) {
    s.currency.hafCoin = nonNeg(s.currency.hafCoin, 0) + nonNegInt(item.count, 0);
  }
  s.safebox.items.splice(idx, 1);
  notify();
  return { ok: true, msg: `${item.name} 已取出` };
}

/** 清空保险箱 */
export function withdrawAll(s = getState()) {
  if (s.run) return { ok: false, msg: '行动进行中，无法调整保险箱' };
  const items = [...(s.safebox.items || [])];
  items.forEach((it) => withdraw(it.uid, s));
  return { ok: true, msg: '保险箱已清空' };
}

/** 保险箱视图数据 */
export function safeboxView(s = getState()) {
  return {
    capacity: capacity(s),
    used: usedSlots(s),
    full: isFull(s),
    empty: isEmpty(s),
    totalValue: safeboxValue(s),
    items: (s.safebox.items || []).map((it) => ({
      ...it,
      rarityName: RARITY_META[it.rarity]?.name || '普通'
    }))
  };
}
