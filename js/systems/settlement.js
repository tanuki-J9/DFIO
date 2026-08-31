/**
 * 结算系统
 * 撤离成功：本轮携带物资全额入库（需求 2.1）
 * 撤离失败：仅保留保险箱物品，清除其余携带物资与所携装备并清空槽位（需求 2.4 / 2.7 / 6.8）
 */

import {
  SLOT_IDS, RARITY, getTemplate, getMaterial, getAmmo, getCollectible
} from '../config/index.js';
import {
  getState, notify, batch, setPhase, PHASE, VIEW, FAIL_REASON, createInitialState
} from '../core/state.js';
import { saveNow } from '../core/storage.js';
import { nonNeg, nonNegInt } from '../core/utils.js';
import {
  grantEquipment, grantMaterial, removeEquipment, warehouseFree, warehouseItemSlots
} from './equipment.js';
import { addAmmoRounds } from './ammo.js';
import { getReadiness } from './readiness.js';
import { LOOT_KIND, carrySummary } from './loot.js';
import { recordGallery, gainCollectible } from './collection.js';
import { settleCommanderXp } from './commander.js';
import { protectedCollectibleCount } from './base.js';

/** 将一组战利品条目实际入库 */
function depositItems(items, s, { allowProtectedCollectibleOverflow = false } = {}) {
  const gained = {
    hafCoin: 0,
    equipment: [],
    materials: [],
    collectibles: [],
    ammo: [],
    depositedItems: [],
    pendingItems: []
  };
  items.forEach((it) => {
    if (!it) return;
    if (it.kind === LOOT_KIND.HAF) {
      const n = nonNegInt(it.count, 0);
      s.currency.hafCoin = nonNeg(s.currency.hafCoin, 0) + n;
      gained.hafCoin += n;
      gained.depositedItems.push(it);
    } else if (it.kind === LOOT_KIND.MATERIAL) {
      if (!getMaterial(it.tplId) || warehouseItemSlots(it, s) > warehouseFree(s)) {
        gained.pendingItems.push(it);
      } else {
        grantMaterial(it.tplId, nonNegInt(it.count, 1), s);
        gained.materials.push(it);
        gained.depositedItems.push(it);
      }
    } else if (it.kind === LOOT_KIND.AMMO) {
      // 弹药按发数并入仓库储备
      if (!getAmmo(it.tplId) || warehouseItemSlots(it, s) > warehouseFree(s)) {
        gained.pendingItems.push(it);
      } else {
        addAmmoRounds(it.tplId, nonNegInt(it.count, 0), s);
        gained.ammo.push(it);
        gained.depositedItems.push(it);
      }
    } else if (it.kind === LOOT_KIND.EQUIPMENT) {
      const count = Math.max(1, nonNegInt(it.count, 1));
      for (let index = 0; index < count; index += 1) {
        const unit = count === 1 ? it : {
          ...it,
          uid: `${it.uid || 'equipment'}_${index + 1}`,
          count: 1,
          value: Math.floor(nonNeg(it.value, 0) / count)
        };
        if (!getTemplate(unit.tplId) || warehouseItemSlots(unit, s) > warehouseFree(s)) {
          gained.pendingItems.push(unit);
          continue;
        }
        grantEquipment(unit.tplId, s);
        recordGallery(unit.tplId, s);
        gained.equipment.push(unit);
        gained.depositedItems.push(unit);
      }
    } else if (it.kind === LOOT_KIND.COLLECTIBLE) {
      const tpl = getCollectible(it.tplId);
      const needsSlot = warehouseItemSlots(it, s) > warehouseFree(s);
      // A full warehouse must not deadlock the first physical red copy. This
      // exception may overfill storage by one stack; subsequent writes still
      // observe zero free slots until the player makes room.
      const protectedOverflow = allowProtectedCollectibleOverflow
        && tpl?.rarity === RARITY.RED
        && protectedCollectibleCount(tpl.id, s) === 0;
      if (!tpl || (needsSlot && !protectedOverflow)) {
        gained.pendingItems.push(it);
      } else {
        gainCollectible(it.tplId, nonNegInt(it.count, 1), s);
        gained.collectibles.push(it);
        gained.depositedItems.push(it);
      }
    } else {
      // Unknown legacy loot remains visible and can only be explicitly discarded.
      gained.pendingItems.push(it);
    }
  });
  return gained;
}

function itemValue(items) {
  return (items || []).reduce((sum, item) => sum + nonNeg(item?.value, 0), 0);
}

/** 失败时：保险箱内的物品保留，箱外物品全部清除 */
function keepSafeboxOnly(s) {
  const kept = [];
  const items = [...(s.safebox.items || [])];

  items.forEach((it) => {
    if (it.kind === LOOT_KIND.HAF) {
      s.currency.hafCoin = nonNeg(s.currency.hafCoin, 0) + nonNegInt(it.count, 0);
    }
    // 装备与材料本身已在仓库中，保险箱只是「不被清除」的标记，故此处无需再入库
    kept.push(it);
  });

  s.safebox.items = [];
  return kept;
}

/** 失败时清除所携装备并清空全部干员槽位，同步下调战备 */
function loseCarriedEquipment(s) {
  const lost = [];
  const protectedUids = new Set(
    (s.safebox.items || []).map((it) => it.srcUid).filter(Boolean)
  );

  Object.values(s.loadouts || {}).forEach((slots) => {
    if (!slots) return;
    SLOT_IDS.forEach((slot) => {
      const instUid = slots[slot];
      if (!instUid) return;
      if (protectedUids.has(instUid)) {
        slots[slot] = null;
        return;
      }
      const inst = s.inventory.find((it) => it.uid === instUid);
      const tpl = inst ? getTemplate(inst.tplId) : null;
      if (tpl) {
        lost.push({
          kind: LOOT_KIND.EQUIPMENT,
          tplId: tpl.id,
          name: tpl.name,
          rarity: tpl.rarity,
          count: 1,
          value: nonNeg(tpl.value, 0)
        });
      }
      // removeEquipment 会顺带清空所有引用该实例的槽位
      removeEquipment(instUid, s);
      slots[slot] = null;
    });
  });

  return lost;
}

/** 失败时清除仓库中未受保险箱保护的材料 */
function loseUnprotectedMaterials(s, keptBoxItems) {
  const protectedMats = {};
  keptBoxItems.forEach((it) => {
    if (it.kind === LOOT_KIND.MATERIAL) {
      protectedMats[it.tplId] = nonNegInt(protectedMats[it.tplId], 0) + nonNegInt(it.count, 0);
    }
  });
  const next = {};
  Object.entries(protectedMats).forEach(([matId, n]) => {
    const have = nonNegInt(s.materials[matId], 0);
    const keep = Math.min(have, n);
    if (keep > 0) next[matId] = keep;
  });
  s.materials = next;
}

/** 失败时清除仓库中的收藏品（图鉴记录不受影响） */
function loseCollectibles(s) {
  const lost = [];
  Object.entries(s.collectibles || {}).forEach(([id, n]) => {
    const tpl = getCollectible(id);
    const count = nonNegInt(n, 0);
    if (!tpl || count <= 0) return;
    lost.push({
      kind: LOOT_KIND.COLLECTIBLE,
      tplId: tpl.id,
      name: tpl.name,
      rarity: tpl.rarity,
      count,
      value: nonNeg(tpl.value, 0) * count
    });
  });
  s.collectibles = {};
  return lost;
}

/**
 * 执行一轮结算
 * @param {{ success: boolean, reason: string|null }} param0
 */
export function settle({ success, reason }) {
  const s = getState();
  const run = s.run;
  if (!run) return null;

  const readinessBefore = getReadiness(s);
  const summary = carrySummary(run);
  const carried = [...run.carry.items];

  let result = null;

  batch(() => {
    setPhase(PHASE.SETTLE, { at: Date.now() });
    const commanderXp = settleCommanderXp(!!success, s);

    s.stats.runs += 1;

    if (success) {
      const ammoLeft = nonNegInt(run.ammo?.rounds, 0);
      const ammoTpl = getAmmo(run.ammo?.ammoId);
      const returnedAmmo = ammoTpl && ammoLeft > 0
        ? depositItems([{
            uid: `ammo-return-${run.id}`,
            kind: LOOT_KIND.AMMO,
            tplId: ammoTpl.id,
            name: ammoTpl.name,
            rarity: ammoTpl.rarity,
            count: ammoLeft,
            value: nonNeg(ammoTpl.valuePerRound, 0) * ammoLeft,
            returningAmmo: true
          }], s)
        : depositItems([], s);
      const gained = depositItems(carried, s);
      // 未打完的弹药也是成功带回的物资；满仓时必须进入待处理清单。
      const ammoBack = returnedAmmo.depositedItems
        .reduce((sum, item) => sum + nonNegInt(item.count, 0), 0);
      const pendingItems = [...returnedAmmo.pendingItems, ...gained.pendingItems];
      // 成功时保险箱内容原样保留，哈夫币退回
      const boxKept = keepSafeboxOnly(s);
      s.stats.success += 1;

      result = {
        success: true,
        reason: null,
        reasonText: '撤离成功',
        mapId: run.mapId,
        difficulty: run.difficulty,
        gainedItems: gained.depositedItems,
        pendingItems,
        keptItems: boxKept,
        lostItems: [],
        gainedValue: summary.total,
        keptValue: itemValue(gained.depositedItems),
        overflowValue: itemValue(pendingItems),
        lostValue: 0,
        hafCoinGained: gained.hafCoin,
        ammoSpent: nonNegInt(run.ammo?.spent, 0),
        ammoReturned: ammoBack,
        counters: { ...run.counters },
        readinessBefore,
        readinessAfter: readinessBefore,
        duration: Math.round((Date.now() - run.startedAt) / 1000),
        safeboxWasEmpty: boxKept.length === 0,
        commanderXp
      };
    } else {
      const boxKept = keepSafeboxOnly(s);
      const lostEquip = loseCarriedEquipment(s);
      loseUnprotectedMaterials(s, boxKept);
      const lostCols = loseCollectibles(s);

      if (reason === FAIL_REASON.TIMEOUT) s.stats.timeout += 1;
      else s.stats.wiped += 1;

      const keptValue = boxKept.reduce((sum, it) => sum + nonNeg(it.value, 0), 0);
      const lostItems = [...carried, ...lostEquip, ...lostCols];
      const lostValue = lostItems.reduce((sum, it) => sum + nonNeg(it.value, 0), 0);

      result = {
        success: false,
        reason: reason || FAIL_REASON.WIPED,
        reasonText: reason === FAIL_REASON.TIMEOUT ? '撤离超时' : '小队被击溃',
        mapId: run.mapId,
        difficulty: run.difficulty,
        gainedItems: carried,
        pendingItems: [],
        keptItems: boxKept,
        lostItems,
        gainedValue: summary.total,
        keptValue,
        overflowValue: 0,
        lostValue,
        hafCoinGained: 0,
        ammoSpent: nonNegInt(run.ammo?.spent, 0),
        ammoReturned: 0,
        counters: { ...run.counters },
        readinessBefore,
        readinessAfter: 0,
        duration: Math.round((Date.now() - run.startedAt) / 1000),
        safeboxWasEmpty: boxKept.length === 0,
        commanderXp
      };
    }

    if (!success) result.readinessAfter = getReadiness(s);

    s.lastSettlement = result;
    s.run = null;
    s.view = VIEW.PREPARE;
  });

  saveNow();
  notify();
  return result;
}

function overflowSaleValue(item) {
  const count = Math.max(1, nonNegInt(item?.count, 1));
  if (item?.kind === LOOT_KIND.EQUIPMENT) {
    const tpl = getTemplate(item.tplId);
    return tpl ? Math.floor(nonNeg(tpl.value, 0) * count * 0.6) : null;
  }
  if (item?.kind === LOOT_KIND.AMMO) {
    const tpl = getAmmo(item.tplId);
    return tpl ? Math.floor(nonNeg(tpl.valuePerRound, 0) * count * 0.6) : null;
  }
  if (item?.kind === LOOT_KIND.MATERIAL) {
    const tpl = getMaterial(item.tplId);
    return tpl ? Math.round(nonNeg(tpl.value, 0) * count) : null;
  }
  if (item?.kind === LOOT_KIND.COLLECTIBLE) {
    const tpl = getCollectible(item.tplId);
    return tpl ? Math.round(nonNeg(tpl.value, 0) * count) : null;
  }
  return null;
}

function pendingCollectibleCount(id, pending) {
  return (pending || []).reduce((sum, item) => {
    if (item?.kind !== LOOT_KIND.COLLECTIBLE || item.tplId !== id) return sum;
    return sum + Math.max(1, nonNegInt(item.count, 1));
  }, 0);
}

/**
 * Describe how much of one pending settlement row may be destructively
 * resolved without consuming the first held/gallery red copy.
 */
export function settlementOverflowActionState(item, pending, s = getState()) {
  const count = Math.max(1, nonNegInt(item?.count, 1));
  const tpl = item?.kind === LOOT_KIND.COLLECTIBLE ? getCollectible(item.tplId) : null;
  if (!tpl || tpl.rarity !== RARITY.RED) {
    return { protectedCount: 0, consumableCount: count, protectedRed: false };
  }

  const heldProtected = protectedCollectibleCount(tpl.id, s);
  const pendingTotal = pendingCollectibleCount(tpl.id, pending);
  const otherPending = Math.max(0, pendingTotal - count);
  const reserveNeeded = heldProtected > 0 ? 0 : 1;
  const protectedCount = Math.min(count, Math.max(0, reserveNeeded - otherPending));
  return {
    protectedCount,
    consumableCount: Math.max(0, count - protectedCount),
    protectedRed: true
  };
}

function keepPendingRemainder(item, resolvedCount) {
  const count = Math.max(1, nonNegInt(item?.count, 1));
  const remaining = Math.max(0, count - resolvedCount);
  if (remaining <= 0) return null;
  return {
    ...item,
    count: remaining,
    value: Math.round(nonNeg(item?.value, 0) * remaining / count)
  };
}

/** Resolve one successfully extracted item that could not fit in the warehouse. */
export function resolveSettlementOverflow(itemUid, action, s = getState()) {
  const result = s?.lastSettlement;
  const pending = result?.pendingItems;
  if (!result?.success || !Array.isArray(pending)) {
    return { ok: false, msg: '当前没有待处理的撤离物资' };
  }
  const index = pending.findIndex((item) => item?.uid === itemUid);
  if (index < 0) return { ok: false, msg: '待处理物资不存在' };
  const item = pending[index];
  const actionState = settlementOverflowActionState(item, pending, s);
  let gain = 0;
  let protectedOverflow = false;

  if (action === 'store') {
    protectedOverflow = actionState.protectedRed
      && protectedCollectibleCount(item.tplId, s) === 0
      && warehouseItemSlots(item, s) > warehouseFree(s);
    const deposited = depositItems([item], s, {
      allowProtectedCollectibleOverflow: actionState.protectedRed
    });
    if (!deposited.depositedItems.length) {
      return { ok: false, msg: '仓库仍无可用容量，请出售或丢弃物品后再试' };
    }
    pending.splice(index, 1, ...deposited.pendingItems);
    if (item.returningAmmo) {
      result.ammoReturned = nonNegInt(result.ammoReturned, 0)
        + deposited.depositedItems.reduce((sum, one) => sum + nonNegInt(one.count, 0), 0);
    } else {
      result.gainedItems.push(...deposited.depositedItems);
    }
    result.hafCoinGained += deposited.hafCoin;
    if (!item.returningAmmo) result.keptValue += itemValue(deposited.depositedItems);
  } else if (action === 'sell') {
    if (actionState.protectedRed && actionState.consumableCount <= 0) {
      return { ok: false, msg: '首件大红受收藏保护，无法出售；请尝试入库，满仓时会启用保护入库' };
    }
    const resolvedCount = Math.min(
      Math.max(1, nonNegInt(item?.count, 1)),
      actionState.consumableCount
    );
    const sale = overflowSaleValue({ ...item, count: resolvedCount });
    if (sale === null) return { ok: false, msg: '该物资数据异常，只能丢弃' };
    gain = sale;
    s.currency.hafCoin = nonNeg(s.currency.hafCoin, 0) + gain;
    result.hafCoinGained = nonNeg(result.hafCoinGained, 0) + gain;
    if (item.kind === LOOT_KIND.EQUIPMENT || item.kind === LOOT_KIND.COLLECTIBLE) {
      recordGallery(item.tplId, s);
    }
    const remainder = keepPendingRemainder(item, resolvedCount);
    pending.splice(index, 1, ...(remainder ? [remainder] : []));
  } else if (action === 'discard') {
    if (actionState.protectedRed && actionState.consumableCount <= 0) {
      return { ok: false, msg: '首件大红受收藏保护，无法丢弃；请尝试入库，满仓时会启用保护入库' };
    }
    const resolvedCount = Math.min(
      Math.max(1, nonNegInt(item?.count, 1)),
      actionState.consumableCount
    );
    const remainder = keepPendingRemainder(item, resolvedCount);
    pending.splice(index, 1, ...(remainder ? [remainder] : []));
  } else {
    return { ok: false, msg: '不支持的溢出处理方式' };
  }

  result.overflowValue = itemValue(pending);
  saveNow();
  notify();
  return {
    ok: true,
    gain,
    remaining: pending.length,
    msg: action === 'store'
      ? (protectedOverflow ? '首件大红已通过满仓保护入库' : '物资已入库')
      : action === 'sell'
        ? `物资已出售，获得 ${gain} 哈夫币`
        : '物资已丢弃'
  };
}

/** 关闭结算界面 */
export function dismissSettlement() {
  const s = getState();
  const pending = s.lastSettlement?.pendingItems;
  if (Array.isArray(pending) && pending.length > 0) {
    return { ok: false, msg: `仍有 ${pending.length} 项撤离物资待处理` };
  }
  s.lastSettlement = null;
  saveNow();
  notify();
  return { ok: true };
}

/** 重置全部进度（调试与重开用） */
export function resetAll() {
  const fresh = createInitialState();
  const s = getState();
  Object.keys(s).forEach((k) => { delete s[k]; });
  Object.assign(s, fresh);
  saveNow();
  notify();
}
