/**
 * 装备配置系统
 * 穿卸装备、仓库管理、商店购买；不提供任何强化机制（需求 8.7）
 */

import {
  SLOT_IDS, EQUIPMENT_TEMPLATES, MATERIAL_TEMPLATES, AMMO_TEMPLATES,
  getTemplate, getMaterial, getAmmo, getCollectible, getOperator, RARITY_META
} from '../config/index.js';
import { getState, notify, spend, addCurrency, emptySlots } from '../core/state.js';
import { uid, nonNeg, nonNegInt } from '../core/utils.js';
import { addAmmoRounds, takeAmmoRounds, normalizeAmmoLoadout, ammoAtkBonus } from './ammo.js';
import { getReadiness } from './readiness.js';
import { baseBonuses, consumableCollectibleCount } from './base.js';

const WAREHOUSE_CATEGORY_ORDER = Object.freeze({
  equipment: 0,
  ammo: 1,
  collectible: 2,
  material: 3
});
const WAREHOUSE_BASE_SLOTS = 10;

function positiveStackTypes(container) {
  return Object.values(container || {}).filter((count) => nonNegInt(count, 0) > 0).length;
}

/** Permanent warehouse capacity supplied by the Storage facility. */
export function warehouseCapacity(s = getState()) {
  return WAREHOUSE_BASE_SLOTS + nonNegInt(baseBonuses(s).warehouseSlots, 0);
}

/**
 * Warehouse slots are explicit: every equipment instance uses one slot, while
 * each non-empty ammo, material, or collectible template stack uses one slot.
 * Currency and safebox references do not consume additional warehouse slots.
 */
export function warehouseUsed(s = getState()) {
  const equipment = Array.isArray(s?.inventory) ? s.inventory.length : 0;
  return equipment
    + positiveStackTypes(s?.ammo)
    + positiveStackTypes(s?.materials)
    + positiveStackTypes(s?.collectibles);
}

export function warehouseFree(s = getState()) {
  return Math.max(0, warehouseCapacity(s) - warehouseUsed(s));
}

/** Number of new warehouse slots a loot/store item needs in the current state. */
export function warehouseItemSlots(item, s = getState()) {
  if (!item || item.kind === 'hafCoin') return 0;
  if (item.kind === 'equipment') return Math.max(1, nonNegInt(item.count, 1));
  if (item.kind === 'ammo') return nonNegInt(s?.ammo?.[item.tplId], 0) > 0 ? 0 : 1;
  if (item.kind === 'material') return nonNegInt(s?.materials?.[item.tplId], 0) > 0 ? 0 : 1;
  if (item.kind === 'collectible') return nonNegInt(s?.collectibles?.[item.tplId], 0) > 0 ? 0 : 1;
  return 1;
}

/** Stable category → rarity → value ordering used by warehouse tools and UI. */
export function stableWarehouseSort(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const category = (WAREHOUSE_CATEGORY_ORDER[a.item?.kind] ?? Number.MAX_SAFE_INTEGER)
        - (WAREHOUSE_CATEGORY_ORDER[b.item?.kind] ?? Number.MAX_SAFE_INTEGER);
      if (category) return category;
      const rarity = nonNeg(RARITY_META[b.item?.rarity]?.tier, 0)
        - nonNeg(RARITY_META[a.item?.rarity]?.tier, 0);
      if (rarity) return rarity;
      const value = nonNeg(b.item?.value, 0) - nonNeg(a.item?.value, 0);
      return value || a.index - b.index;
    })
    .map(({ item }) => item);
}

function sortStackContainer(container, kind, templateOf, valueOf) {
  const entries = Object.entries(container || {}).map(([id, count]) => {
    const tpl = templateOf(id);
    return { id, count, kind, rarity: tpl?.rarity, value: valueOf(tpl) };
  });
  return Object.fromEntries(stableWarehouseSort(entries).map(({ id, count }) => [id, count]));
}

/** Reorder warehouse backing data without changing any item identities or counts. */
export function autoSortWarehouse(s = getState()) {
  if (!baseBonuses(s).autoSort) {
    return { ok: false, msg: '仓储中心达到 8 级后解锁自动整理' };
  }
  if (s.run) return { ok: false, msg: '行动进行中，无法整理仓库' };

  s.inventory = stableWarehouseSort((s.inventory || []).map((item) => {
    const tpl = getTemplate(item.tplId);
    return { ...item, kind: 'equipment', rarity: tpl?.rarity, value: nonNeg(tpl?.value, 0) };
  })).map(({ kind: _kind, rarity: _rarity, value: _value, ...item }) => item);
  s.ammo = sortStackContainer(s.ammo, 'ammo', getAmmo, (tpl) => tpl?.valuePerRound);
  s.collectibles = sortStackContainer(s.collectibles, 'collectible', getCollectible, (tpl) => tpl?.value);
  s.materials = sortStackContainer(s.materials, 'material', getMaterial, (tpl) => tpl?.value);
  notify();
  return { ok: true, msg: '仓库已按分类、稀有度和价值整理' };
}

/** Sell every currently sellable item in one warehouse category after its level-5 gate. */
export function batchSellWarehouseCategory(category, s = getState()) {
  if (!baseBonuses(s).batchSell) {
    return { ok: false, msg: '仓储中心达到 5 级后解锁批量出售' };
  }
  if (s.run) return { ok: false, msg: '行动进行中，无法操作仓库' };

  let sold = 0;
  let gain = 0;
  if (category === 'equipment') {
    const equipped = allEquippedUids(s);
    const boxed = new Set((s.safebox?.items || []).map((item) => item?.srcUid).filter(Boolean));
    [...(s.inventory || [])].forEach((item) => {
      if (equipped.has(item.uid) || boxed.has(item.uid)) return;
      const tpl = getTemplate(item.tplId);
      if (!tpl) return;
      gain += Math.floor(nonNeg(tpl.value, 0) * 0.6);
      if (removeEquipment(item.uid, s)) sold += 1;
    });
  } else if (category === 'ammo') {
    Object.entries(s.ammo || {}).forEach(([id, count]) => {
      const n = nonNegInt(count, 0);
      const tpl = getAmmo(id);
      if (!tpl || n <= 0) return;
      sold += n;
      gain += Math.floor(nonNeg(tpl.valuePerRound, 0) * n * 0.6);
      delete s.ammo[id];
      if (s.ammoLoadout?.ammoId === id) s.ammoLoadout.rounds = 0;
    });
  } else if (category === 'collectible') {
    Object.keys(s.collectibles || {}).forEach((id) => {
      const tpl = getCollectible(id);
      const n = consumableCollectibleCount(id, s);
      if (!tpl || n <= 0) return;
      sold += n;
      gain += Math.round(nonNeg(tpl.value, 0) * n);
      s.collectibles[id] -= n;
      if (s.collectibles[id] <= 0) delete s.collectibles[id];
    });
  } else if (category === 'material') {
    Object.entries(s.materials || {}).forEach(([id, count]) => {
      const boxed = (s.safebox?.items || [])
        .filter((item) => item?.kind === 'material' && item.tplId === id)
        .reduce((sum, item) => sum + nonNegInt(item.count, 0), 0);
      const n = Math.max(0, nonNegInt(count, 0) - boxed);
      const tpl = getMaterial(id);
      if (!tpl || n <= 0) return;
      sold += n;
      gain += Math.round(nonNeg(tpl.value, 0) * n);
      s.materials[id] = nonNegInt(s.materials[id], 0) - n;
      if (s.materials[id] <= 0) delete s.materials[id];
    });
  } else {
    return { ok: false, msg: '仓库分类不存在' };
  }

  if (sold <= 0) return { ok: false, sold: 0, gain: 0, msg: '当前分类没有可出售物品' };
  s.currency.hafCoin = nonNeg(s?.currency?.hafCoin, 0) + gain;
  notify();
  return { ok: true, sold, gain, msg: `已批量出售 ${sold} 件，获得 ${gain} 哈夫币` };
}

/** 取某名干员的槽位表，不存在则按需创建 */
export function loadoutOf(opId, s = getState()) {
  if (!opId) return emptySlots();
  if (!s.loadouts || typeof s.loadouts !== 'object') s.loadouts = {};
  if (!s.loadouts[opId]) s.loadouts[opId] = emptySlots();
  return s.loadouts[opId];
}

function unlockedPresetSlot(slot, s) {
  return Number.isInteger(slot)
    && slot >= 0
    && slot < nonNegInt(baseBonuses(s).loadoutPresetSlots, 0);
}

function copyLoadouts(loadouts) {
  const out = {};
  Object.entries(loadouts || {}).forEach(([opId, source]) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    const slots = {};
    SLOT_IDS.forEach((slot) => {
      if (!Object.hasOwn(source, slot)) return;
      slots[slot] = typeof source[slot] === 'string' ? source[slot] : null;
    });
    out[opId] = slots;
  });
  return out;
}

/** Save the current account-wide operator loadouts into one Command Center slot. */
export function saveLoadoutPreset(slot, s = getState()) {
  if (isLocked(s)) return { ok: false, msg: '行动进行中，无法保存配装预设' };
  if (!unlockedPresetSlot(slot, s)) return { ok: false, msg: '该配装预设槽位尚未解锁' };
  if (!s.base || typeof s.base !== 'object') s.base = {};
  if (!Array.isArray(s.base.loadoutPresets)) s.base.loadoutPresets = [];
  s.base.loadoutPresets[slot] = { loadouts: copyLoadouts(s.loadouts) };
  notify();
  return { ok: true, msg: `配装预设 ${slot + 1} 已保存`, slot };
}

/**
 * Apply a saved preset without deleting inventory. Missing preset references are
 * skipped, and unknown legacy equipment is accepted when its persisted slot matches.
 */
export function applyLoadoutPreset(slot, s = getState()) {
  if (isLocked(s)) return { ok: false, msg: '行动进行中，无法应用配装预设' };
  if (!unlockedPresetSlot(slot, s)) return { ok: false, msg: '该配装预设槽位尚未解锁' };
  const preset = s?.base?.loadoutPresets?.[slot];
  if (!preset?.loadouts || typeof preset.loadouts !== 'object') {
    return { ok: false, msg: `配装预设 ${slot + 1} 尚未保存` };
  }

  const inventory = new Map((s.inventory || [])
    .filter((item) => item && typeof item.uid === 'string')
    .map((item) => [item.uid, item]));
  const next = copyLoadouts(s.loadouts);
  const assignments = [];
  const claimed = new Set();
  let skipped = 0;

  Object.entries(preset.loadouts).forEach(([opId, slots]) => {
    if (!slots || typeof slots !== 'object') return;
    const operator = getOperator(opId);
    const available = operator && !operator.comingSoon && !operator.hidden
      && (operator.unlocked || s?.operators?.unlocked?.includes(opId));
    if (!available) {
      skipped += SLOT_IDS.filter((slotId) => Object.hasOwn(slots, slotId)
        && typeof slots[slotId] === 'string').length;
      return;
    }
    if (!next[opId]) next[opId] = emptySlots();
    SLOT_IDS.forEach((slotId) => {
      if (!Object.hasOwn(slots, slotId)) return;
      const wanted = slots[slotId];
      if (wanted === null) {
        const current = next[opId][slotId];
        const currentItem = current ? inventory.get(current) : null;
        if (!current || (currentItem && getTemplate(currentItem.tplId))) {
          next[opId][slotId] = null;
        }
        return;
      }
      const item = typeof wanted === 'string' ? inventory.get(wanted) : null;
      if (!item || item.slot !== slotId || claimed.has(wanted)) {
        skipped += 1;
        return;
      }
      claimed.add(wanted);
      assignments.push({ opId, slotId, uid: wanted });
    });
  });

  assignments.forEach(({ opId, slotId, uid: instUid }) => {
    Object.values(next).forEach((slots) => {
      if (!slots) return;
      SLOT_IDS.forEach((candidate) => {
        if (slots[candidate] === instUid) slots[candidate] = null;
      });
    });
    next[opId][slotId] = instUid;
  });

  s.loadouts = next;
  notify();
  const suffix = skipped ? `，跳过 ${skipped} 件缺失装备` : '';
  return { ok: true, msg: `配装预设 ${slot + 1} 已应用${suffix}`, slot, skipped };
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
  if (!tpl || warehouseFree(s) < 1) return null;
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
  if (warehouseItemSlots({ kind: 'material', tplId: matId, count: n }, s) > warehouseFree(s)) return false;
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

/** Explicitly remove an equipment instance whose catalog template no longer exists. */
export function discardLegacyEquipment(instUid, s = getState()) {
  if (isLocked(s)) return { ok: false, msg: '行动进行中，无法操作仓库' };
  const inst = (s.inventory || []).find((item) => item?.uid === instUid);
  if (!inst) return { ok: false, msg: '装备不存在' };
  if (getTemplate(inst.tplId)) return { ok: false, msg: '该装备仍可正常使用，无需清理' };
  removeEquipment(instUid, s);
  notify();
  return { ok: true, msg: '未知旧版装备已丢弃' };
}

/** Explicitly remove an ammo stack whose catalog template no longer exists. */
export function discardLegacyAmmo(ammoId, s = getState()) {
  if (isLocked(s)) return { ok: false, msg: '行动进行中，无法操作仓库' };
  if (getAmmo(ammoId)) return { ok: false, msg: '该弹药仍可正常使用，无需清理' };
  if (nonNegInt(s?.ammo?.[ammoId], 0) <= 0) return { ok: false, msg: '弹药不存在' };
  delete s.ammo[ammoId];
  if (s.ammoLoadout?.ammoId === ammoId) {
    s.ammoLoadout.ammoId = null;
    s.ammoLoadout.rounds = 0;
  }
  notify();
  return { ok: true, msg: '未知旧版弹药已丢弃' };
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
      .filter((it) => it.slot === slot && !!getTemplate(it.tplId) && !used.has(it.uid))
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
    .filter((it) => it.slot === slotId && !!getTemplate(it.tplId) && !blocked.has(it.uid))
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

const ARMOR_SHOP_SLOTS = new Set(['armor', 'helmet', 'bag']);

function requiredFacilityLevel(gearLevel) {
  if (gearLevel >= 6) return 9;
  if (gearLevel >= 5) return 6;
  if (gearLevel >= 4) return 4;
  if (gearLevel >= 3) return 2;
  return 1;
}

function equipmentShopTerms(tpl, s) {
  const bonuses = baseBonuses(s);
  if (tpl.slot === 'weapon') {
    return {
      discount: bonuses.weaponDiscount,
      locked: tpl.level > bonuses.maxWeaponLevel,
      requiredFacilityLevel: requiredFacilityLevel(tpl.level),
      facilityName: '军械台'
    };
  }
  if (ARMOR_SHOP_SLOTS.has(tpl.slot)) {
    return {
      discount: bonuses.armorDiscount,
      locked: tpl.level > bonuses.maxArmorLevel,
      requiredFacilityLevel: requiredFacilityLevel(tpl.level),
      facilityName: '防具台'
    };
  }
  return { discount: 0, locked: false, requiredFacilityLevel: null, facilityName: '' };
}

/** Price after the relevant facility discount, rounded to the nearest whole coin. */
export function effectiveShopPrice(tpl, s = getState()) {
  const { discount } = equipmentShopTerms(tpl, s);
  return Math.round(nonNeg(tpl?.price, 0) * (1 - discount));
}

export function shopEquipmentList(s = getState()) {
  return EQUIPMENT_TEMPLATES.map((t) => {
    const terms = equipmentShopTerms(t, s);
    return {
      ...t,
      kind: 'equipment',
      shopPrice: effectiveShopPrice(t, s),
      locked: terms.locked,
      requiredFacilityLevel: terms.requiredFacilityLevel,
      facilityName: terms.facilityName
    };
  });
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
  if (warehouseItemSlots({ kind: 'ammo', tplId: tpl.id, count: n }, s) > warehouseFree(s)) {
    return { ok: false, msg: '仓库容量已满，无法新增弹药堆叠' };
  }
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
  const terms = equipmentShopTerms(tpl, s);
  if (terms.locked) {
    return { ok: false, msg: `${terms.facilityName}达到 ${terms.requiredFacilityLevel} 级后才能购买该装备` };
  }
  if (warehouseFree(s) < 1) return { ok: false, msg: '仓库容量已满，无法购入装备' };
  const price = effectiveShopPrice(tpl, s);
  const have = nonNeg(s?.currency?.hafCoin, 0);
  if (have < price) {
    return { ok: false, msg: `哈夫币不足，还缺 ${Math.ceil(price - have)}` };
  }
  s.currency.hafCoin = have - price;
  const inst = grantEquipment(tplId, s);
  notify();
  return { ok: true, inst, price, msg: `已购入 ${tpl.name}` };
}

/** 用哈夫币购买材料 */
export function buyMaterial(matId, count = 1, s = getState()) {
  const mat = getMaterial(matId);
  if (!mat) return { ok: false, msg: '商品不存在' };
  const n = Math.max(1, nonNegInt(count, 1));
  if (warehouseItemSlots({ kind: 'material', tplId: mat.id, count: n }, s) > warehouseFree(s)) {
    return { ok: false, msg: '仓库容量已满，无法新增材料堆叠' };
  }
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
