/**
 * 结算系统
 * 撤离成功：本轮携带物资全额入库（需求 2.1）
 * 撤离失败：仅保留保险箱物品，清除其余携带物资与所携装备并清空槽位（需求 2.4 / 2.7 / 6.8）
 */

import { SLOT_IDS, getTemplate, getMaterial, getAmmo, getCollectible } from '../config/index.js';
import {
  getState, notify, batch, setPhase, PHASE, VIEW, FAIL_REASON, createInitialState
} from '../core/state.js';
import { saveNow } from '../core/storage.js';
import { nonNeg, nonNegInt } from '../core/utils.js';
import { grantEquipment, grantMaterial, removeEquipment } from './equipment.js';
import { addAmmoRounds, returnAmmoToStock } from './ammo.js';
import { getReadiness } from './readiness.js';
import { LOOT_KIND, carrySummary } from './loot.js';
import { recordGallery, gainCollectible } from './collection.js';

/** 将一组战利品条目实际入库 */
function depositItems(items, s) {
  const gained = { hafCoin: 0, equipment: [], materials: [], collectibles: [], ammo: [] };
  items.forEach((it) => {
    if (!it) return;
    if (it.kind === LOOT_KIND.HAF) {
      const n = nonNegInt(it.count, 0);
      s.currency.hafCoin = nonNeg(s.currency.hafCoin, 0) + n;
      gained.hafCoin += n;
    } else if (it.kind === LOOT_KIND.MATERIAL) {
      if (getMaterial(it.tplId)) {
        grantMaterial(it.tplId, nonNegInt(it.count, 1), s);
        gained.materials.push(it);
      }
    } else if (it.kind === LOOT_KIND.AMMO) {
      // 弹药按发数并入仓库储备
      if (getAmmo(it.tplId)) {
        addAmmoRounds(it.tplId, nonNegInt(it.count, 0), s);
        gained.ammo.push(it);
      }
    } else if (it.kind === LOOT_KIND.EQUIPMENT) {
      if (getTemplate(it.tplId)) {
        grantEquipment(it.tplId, s);
        recordGallery(it.tplId, s);
        gained.equipment.push(it);
      }
    } else if (it.kind === LOOT_KIND.COLLECTIBLE) {
      if (getCollectible(it.tplId)) {
        gainCollectible(it.tplId, nonNegInt(it.count, 1), s);
        gained.collectibles.push(it);
      }
    }
  });
  return gained;
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

    s.stats.runs += 1;

    if (success) {
      const gained = depositItems(carried, s);
      // 撤离成功：本轮没打完的弹药随小队带回，退回仓库储备
      const ammoBack = returnAmmoToStock(run.ammo, s);
      // 成功时保险箱内容原样保留，哈夫币退回
      const boxKept = keepSafeboxOnly(s);
      s.stats.success += 1;

      result = {
        success: true,
        reason: null,
        reasonText: '撤离成功',
        mapId: run.mapId,
        difficulty: run.difficulty,
        gainedItems: carried,
        keptItems: boxKept,
        lostItems: [],
        gainedValue: summary.total,
        keptValue: summary.total,
        lostValue: 0,
        hafCoinGained: gained.hafCoin,
        ammoSpent: nonNegInt(run.ammo?.spent, 0),
        ammoReturned: ammoBack,
        counters: { ...run.counters },
        readinessBefore,
        readinessAfter: readinessBefore,
        duration: Math.round((Date.now() - run.startedAt) / 1000),
        safeboxWasEmpty: boxKept.length === 0
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
        keptItems: boxKept,
        lostItems,
        gainedValue: summary.total,
        keptValue,
        lostValue,
        hafCoinGained: 0,
        ammoSpent: nonNegInt(run.ammo?.spent, 0),
        ammoReturned: 0,
        counters: { ...run.counters },
        readinessBefore,
        readinessAfter: 0,
        duration: Math.round((Date.now() - run.startedAt) / 1000),
        safeboxWasEmpty: boxKept.length === 0
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

/** 关闭结算界面 */
export function dismissSettlement() {
  const s = getState();
  s.lastSettlement = null;
  notify();
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
