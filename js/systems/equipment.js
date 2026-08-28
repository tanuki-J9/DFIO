/**
 * 装备配置系统
 * 穿卸装备、仓库管理、商店购买；不提供任何强化机制（需求 8.7）
 */

import {
  SLOT_IDS, EQUIPMENT_TEMPLATES, MATERIAL_TEMPLATES, AMMO_TEMPLATES,
  getTemplate, getMaterial, getAmmo, RARITY_META
} from '../config/index.js';
import { getState, notify, spend, addCurrency, emptySlots } from '../core/state.js';
import { uid, nonNeg, nonNegInt } from '../core/utils.js';
import { addAmmoRounds, takeAmmoRounds, normalizeAmmoLoadout, ammoAtkBonus } from './ammo.js';
import { getReadiness } from './readiness.js';

/** 取某名干员的槽位表，不存在则按需创建 */
export function loadoutOf(opId, s = getState()) {
  if (!opId) return emptySlots();
  if (!s.loadouts || typeof s.loadouts !== 'object') s.loadouts = {};
  if (!s.loadouts[opId]) s.loadouts[opId] = emptySlots();
  return s.loadouts[opId];
}

/** 全部干员已占用的装备 uid 集合 */
export function allEquippedUids(s = getState()) {
  const set = new Set();
  Object.values(s.loadouts || {}).forEach((slots) => {
    if (!slots) return;
    SLOT_IDS.forEach((slot) => {
      if (slots[slot]) set.add(slots[slot]);
    });
  });
  return set;
}

/** 某件装备当前被哪名干员占用 */
export function holderOf(instUid, s = getState()) {
  if (!instUid) return null;
  const found = Object.entries(s.loadouts || {})
    .find(([, slots]) => slots && SLOT_IDS.some((slot) => slots[slot] === instUid));
  return found ? found[0] : null;
}

/** 新建装备实例并入库 */
export function grantEquipment(tplId, s = getState()) {
  const tpl = getTemplate(tplId);
  if (!tpl) return null;
  const inst = { uid: uid('eq'), tplId: tpl.id, slot: tpl.slot };
  s.inventory.push(inst);
  return inst;
}

/** 材料入库 */
export function grantMaterial(matId, count = 1, s = getState()) {
  const mat = getMaterial(matId);
  if (!mat) return false;
  const n = nonNegInt(count, 0);
  if (n <= 0) return false;
  s.materials[matId] = nonNegInt(s.materials[matId], 0) + n;
  return true;
}

/** 移除装备实例（同时清空任意干员占用的槽位） */
export function removeEquipment(instUid, s = getState()) {
  const idx = s.inventory.findIndex((it) => it.uid === instUid);
  if (idx < 0) return false;
  Object.values(s.loadouts || {}).forEach((slots) => {
    if (!slots) return;
    SLOT_IDS.forEach((slot) => {
      if (slots[slot] === instUid) slots[slot] = null;
    });
  });
  s.inventory.splice(idx, 1);
  return true;
}

/** 是否处于行动中（行动中禁止调整配置，需求 4.10） */
function isLocked(s) {
  return !!s.run;
}

/** 穿戴装备至指定干员的对应槽位（若已被他人占用则自动转移） */
export function equip(instUid, opId, s = getState()) {
  if (isLocked(s)) return { ok: false, msg: '行动进行中，无法调整装备' };
  if (!opId) return { ok: false, msg: '请先选择要配装的干员' };
  const inst = s.inventory.find((it) => it.uid === instUid);
  if (!inst) return { ok: false, msg: '仓库中不存在该装备' };
  const tpl = getTemplate(inst.tplId);
  if (!tpl) return { ok: false, msg: '装备数据异常' };

  const before = getReadiness(s);
  // 先从原持有者身上摘下，保证一件装备只被一人占用
  const prev = holderOf(inst.uid, s);
  if (prev) {
    const prevSlots = loadoutOf(prev, s);
    SLOT_IDS.forEach((slot) => {
      if (prevSlots[slot] === inst.uid) prevSlots[slot] = null;
    });
  }
  loadoutOf(opId, s)[tpl.slot] = inst.uid;
  notify();
  return { ok: true, slot: tpl.slot, movedFrom: prev && prev !== opId ? prev : null, before, after: getReadiness(s) };
}

/** 卸下某名干员的指定槽位 */
export function unequip(slotId, opId, s = getState()) {
  if (isLocked(s)) return { ok: false, msg: '行动进行中，无法调整装备' };
  if (!SLOT_IDS.includes(slotId)) return { ok: false, msg: '槽位不存在' };
  const slots = loadoutOf(opId, s);
  if (!slots[slotId]) return { ok: false, msg: '该槽位为空' };
  const before = getReadiness(s);
  slots[slotId] = null;
  notify();
  return { ok: true, before, after: getReadiness(s) };
}

/** 为某名干员一键最优配装：每个槽位选价值最高的未被占用装备 */
export function autoEquipBest(opId, s = getState()) {
  if (isLocked(s)) return { ok: false, msg: '行动进行中，无法调整装备' };
  if (!opId) return { ok: false, msg: '请先选择要配装的干员' };
  const before = getReadiness(s);
  const slots = loadoutOf(opId, s);
  // 其他干员已占用的装备不参与，避免互相抢装
  const used = new Set(allEquippedUids(s));
  SLOT_IDS.forEach((slot) => { if (slots[slot]) used.delete(slots[slot]); });

  SLOT_IDS.forEach((slot) => {
    const candidates = s.inventory
      .filter((it) => it.slot === slot && !used.has(it.uid))
      .sort((a, b) => nonNeg(getTemplate(b.tplId)?.value, 0) - nonNeg(getTemplate(a.tplId)?.value, 0));
    if (candidates.length) {
      slots[slot] = candidates[0].uid;
      used.add(candidates[0].uid);
    } else {
      slots[slot] = null;
    }
  });
  notify();
  return { ok: true, before, after: getReadiness(s) };
}

/** 为全部上阵干员依次最优配装 */
export function autoEquipSquad(s = getState()) {
  if (isLocked(s)) return { ok: false, msg: '行动进行中，无法调整装备' };
  const squad = (s.operators?.squad || []).filter(Boolean);
  if (!squad.length) return { ok: false, msg: '尚未上阵任何干员' };
  const before = getReadiness(s);
  squad.forEach((opId) => autoEquipBest(opId, s));
  notify();
  return { ok: true, before, after: getReadiness(s) };
}

/** 清空某名干员的全部槽位；未指定干员则清空所有人 */
export function unequipAll(opId = null, s = getState()) {
  if (isLocked(s)) return { ok: false, msg: '行动进行中，无法调整装备' };
  const before = getReadiness(s);
  if (opId) {
    const slots = loadoutOf(opId, s);
    SLOT_IDS.forEach((slot) => { slots[slot] = null; });
  } else {
    Object.values(s.loadouts || {}).forEach((slots) => {
      if (!slots) return;
      SLOT_IDS.forEach((slot) => { slots[slot] = null; });
    });
  }
  notify();
  return { ok: true, before, after: getReadiness(s) };
}

/** 某干员某槽位的可选装备列表（含当前已装备项，排除他人占用项） */
export function candidatesForSlot(slotId, opId, s = getState()) {
  const slots = loadoutOf(opId, s);
  const blocked = new Set(allEquippedUids(s));
  // 自己身上的装备不算冲突
  SLOT_IDS.forEach((slot) => { if (slots[slot]) blocked.delete(slots[slot]); });

  return s.inventory
    .filter((it) => it.slot === slotId && !blocked.has(it.uid))
    .map((it) => {
      const tpl = getTemplate(it.tplId);
      return {
        uid: it.uid,
        tplId: it.tplId,
        name: tpl.name,
        rarity: tpl.rarity,
        rarityName: RARITY_META[tpl.rarity].name,
        value: tpl.value,
        atk: tpl.atk,
        hp: tpl.hp,
        def: tpl.def,
        equipped: slots[slotId] === it.uid
      };
    })
    .sort((a, b) => b.value - a.value);
}

/** 单名干员的装备属性汇总 */
export function operatorGearStats(opId, s = getState()) {
  const out = { atk: 0, hp: 0, def: 0, value: 0, count: 0 };
  const slots = loadoutOf(opId, s);
  SLOT_IDS.forEach((slot) => {
    const instUid = slots[slot];
    if (!instUid) return;
    const inst = s.inventory.find((it) => it.uid === instUid);
    const tpl = inst ? getTemplate(inst.tplId) : null;
    if (!tpl) return;
    out.atk += nonNeg(tpl.atk, 0);
    out.hp += nonNeg(tpl.hp, 0);
    out.def += nonNeg(tpl.def, 0);
    out.value += nonNeg(tpl.value, 0);
    out.count += 1;
  });
  return out;
}

/** 全队装备属性汇总（仅统计上阵干员，不含干员与技能） */
export function loadoutStats(s = getState()) {
  const out = { atk: 0, hp: 0, def: 0 };
  (s.operators?.squad || []).filter(Boolean).forEach((opId) => {
    const one = operatorGearStats(opId, s);
    out.atk += one.atk;
    out.hp += one.hp;
    out.def += one.def;
  });
  // 携带的弹种提供额外攻击加成（按发携带，仅在实际带弹时生效）
  const picked = normalizeAmmoLoadout(s);
  if (picked.ammoId && picked.rounds > 0) {
    out.atk += ammoAtkBonus(picked.ammoId);
  }
  return out;
}

/** 出发时标记携带中的装备快照：{ [opId]: { slot: uid } } */
export function makeLoadoutSnapshot(s = getState()) {
  const snap = {};
  (s.operators?.squad || []).filter(Boolean).forEach((opId) => {
    const slots = loadoutOf(opId, s);
    const one = {};
    SLOT_IDS.forEach((slot) => { one[slot] = slots[slot] || null; });
    snap[opId] = one;
  });
  return snap;
}

/* ============ 商店 ============ */

export function shopEquipmentList() {
  return EQUIPMENT_TEMPLATES.map((t) => ({ ...t, kind: 'equipment' }));
}

export function shopMaterialList() {
  return MATERIAL_TEMPLATES.map((t) => ({ ...t, kind: 'material' }));
}

/** 弹药商店：按发计价，展示各弹种单价与可选整发档位 */
export function shopAmmoList(s = getState()) {
  return AMMO_TEMPLATES.map((t) => ({
    ...t,
    kind: 'ammo',
    stock: nonNegInt(s?.ammo?.[t.id], 0)
  }));
}

/**
 * 按发购买弹药：每一发单独计价，总价 = 单价 × 发数
 * @param {string} ammoId 弹种 id
 * @param {number} rounds 购买发数
 */
export function buyAmmo(ammoId, rounds = 1, s = getState()) {
  const tpl = getAmmo(ammoId);
  if (!tpl) return { ok: false, msg: '该弹种不存在' };
  if (s.run) return { ok: false, msg: '行动进行中，无法采购弹药' };
  const n = Math.max(1, nonNegInt(rounds, 1));
  const price = Math.round(nonNeg(tpl.pricePerRound, 0) * n);
  if (!spend('hafCoin', price)) {
    return { ok: false, msg: `哈夫币不足，还缺 ${Math.ceil(price - nonNeg(s.currency.hafCoin, 0))}` };
  }
  addAmmoRounds(tpl.id, n, s);
  notify();
  return { ok: true, msg: `已采购 ${tpl.name} ×${n} 发，花费 ${price} 哈夫币` };
}

/** 出售弹药：按单发价值的 6 折回收 */
export function sellAmmo(ammoId, rounds = 1, s = getState()) {
  const tpl = getAmmo(ammoId);
  if (!tpl) return { ok: false, msg: '该弹种不存在' };
  if (s.run) return { ok: false, msg: '行动进行中，无法出售弹药' };
  const n = takeAmmoRounds(tpl.id, Math.max(1, nonNegInt(rounds, 1)), s);
  if (n <= 0) return { ok: false, msg: '库存中没有该弹药' };
  const gain = Math.floor(nonNeg(tpl.valuePerRound, 0) * n * 0.6);
  addCurrency('hafCoin', gain);
  // 出售后同步夹取待携带发数
  if (s.ammoLoadout?.ammoId === tpl.id) {
    s.ammoLoadout.rounds = Math.min(nonNegInt(s.ammoLoadout.rounds, 0), nonNegInt(s.ammo[tpl.id], 0));
  }
  notify();
  return { ok: true, msg: `已出售 ${tpl.name} ×${n} 发，回收 ${gain} 哈夫币` };
}

/** 用哈夫币购买装备 */
export function buyEquipment(tplId, s = getState()) {
  const tpl = getTemplate(tplId);
  if (!tpl) return { ok: false, msg: '商品不存在' };
  const price = nonNeg(tpl.price, 0);
  if (!spend('hafCoin', price)) {
    return { ok: false, msg: `哈夫币不足，还缺 ${Math.ceil(price - nonNeg(s.currency.hafCoin, 0))}` };
  }
  const inst = grantEquipment(tplId, s);
  notify();
  return { ok: true, inst, msg: `已购入 ${tpl.name}` };
}

/** 用哈夫币购买材料 */
export function buyMaterial(matId, count = 1, s = getState()) {
  const mat = getMaterial(matId);
  if (!mat) return { ok: false, msg: '商品不存在' };
  const n = Math.max(1, nonNegInt(count, 1));
  const price = nonNeg(mat.price, 0) * n;
  if (!spend('hafCoin', price)) {
    return { ok: false, msg: `哈夫币不足，还缺 ${Math.ceil(price - nonNeg(s.currency.hafCoin, 0))}` };
  }
  grantMaterial(matId, n, s);
  notify();
  return { ok: true, msg: `已购入 ${mat.name} ×${n}` };
}

/** 出售装备（回收部分哈夫币），不可出售携带中的装备 */
export function sellEquipment(instUid, s = getState()) {
  if (isLocked(s)) return { ok: false, msg: '行动进行中，无法出售装备' };
  const inst = s.inventory.find((it) => it.uid === instUid);
  if (!inst) return { ok: false, msg: '装备不存在' };
  if (allEquippedUids(s).has(instUid)) return { ok: false, msg: '携带中的装备不可出售，请先卸下' };
  const tpl = getTemplate(inst.tplId);
  const gain = Math.floor(nonNeg(tpl?.value, 0) * 0.6);
  removeEquipment(instUid, s);
  addCurrency('hafCoin', gain);
  notify();
  return { ok: true, msg: `已出售 ${tpl?.name || '装备'}，回收 ${gain} 哈夫币` };
}
