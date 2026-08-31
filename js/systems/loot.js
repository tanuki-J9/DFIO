/**
 * 战利品系统
 * 战利品仅来自补给箱与击杀（需求 1.5），统一写入「本轮携带物资」而非直接入库（需求 1.6）
 *
 * 掉落分两层：基础池（全地图共通材料）+ 地图专属池（金色 / 红色收藏品）
 */

import {
  CRATE_TIERS, CRATE_DISTRIBUTION, LOOT_TYPE_WEIGHTS,
  EQUIPMENT_TEMPLATES, MATERIAL_TEMPLATES, AMMO_TEMPLATES, AMMO_PACK_SIZES,
  COLLECTIBLE_TEMPLATES,
  RARITY, RARITY_META, RARITY_ORDER,
  mapCollectiblePool, mapMaterialPool,
  getTemplate, getMaterial, getCollectible, getAmmo
} from '../config/index.js';
import { getState } from '../core/state.js';
import { randInt, weightedPick, uid, nonNeg, pick } from '../core/utils.js';
import { addRunXp } from './commander.js';

export const LOOT_KIND = {
  HAF: 'hafCoin',
  MATERIAL: 'material',
  EQUIPMENT: 'equipment',
  AMMO: 'ammo',
  COLLECTIBLE: 'collectible'
};

/** 当前行动所在地图；不在行动中时返回 null */
function currentMapId(s = getState()) {
  return s?.run?.mapId || null;
}

/** 按地图分支档位与技能加成，抽取补给箱档位 */
export function rollCrateTier(branchCrateTier, crateTierBonus = 0) {
  const dist = CRATE_DISTRIBUTION[branchCrateTier] || CRATE_DISTRIBUTION[1];
  const weights = {};
  Object.entries(dist).forEach(([tier, w]) => {
    const t = Number(tier);
    // 情报网络技能：提升高档箱权重
    const boost = 1 + nonNeg(crateTierBonus, 0) * (t - 1);
    weights[tier] = nonNeg(w, 0) * boost;
  });
  const picked = weightedPick(weights);
  const tier = Number(picked) || 1;
  return { tier, conf: CRATE_TIERS[tier] || CRATE_TIERS[1] };
}

/** 稀有度上限内随机一个稀有度 */
function rollRarityUpTo(maxRarity) {
  const order = RARITY_ORDER;
  const cap = Math.max(0, order.indexOf(maxRarity));
  const weights = {};
  for (let i = 0; i <= cap; i += 1) {
    weights[order[i]] = Math.max(1, (cap - i + 1) * 12);
  }
  return weightedPick(weights) || RARITY.COMMON;
}

function makeLootEntry(tpl, kind, count, valueBonus) {
  return {
    uid: uid('loot'),
    kind,
    tplId: tpl.id,
    name: tpl.name,
    rarity: tpl.rarity,
    rarityName: RARITY_META[tpl.rarity]?.name || '普通',
    level: tpl.level || 0,
    count,
    value: Math.round(nonNeg(tpl.value, 0) * count * (1 + nonNeg(valueBonus, 0)))
  };
}

function makeEquipmentLoot(maxRarity, valueBonus) {
  const rarity = rollRarityUpTo(maxRarity);
  const pool = EQUIPMENT_TEMPLATES.filter((t) => t.rarity === rarity);
  const tpl = pick(pool.length ? pool : EQUIPMENT_TEMPLATES);
  if (!tpl) return null;
  return makeLootEntry(tpl, LOOT_KIND.EQUIPMENT, 1, valueBonus);
}

/** 弹药掉落：按稀有度上限抽取弹种，掉落量以「发」为单位 */
function makeAmmoLoot(maxRarity, valueBonus, rounds = 0) {
  const rarity = rollRarityUpTo(maxRarity);
  const pool = AMMO_TEMPLATES.filter((t) => t.rarity === rarity);
  const tpl = pick(pool.length ? pool : AMMO_TEMPLATES);
  if (!tpl) return null;
  const n = rounds > 0 ? rounds : pick(AMMO_PACK_SIZES.slice(0, 3)) || 30;
  return {
    uid: uid('loot'),
    kind: LOOT_KIND.AMMO,
    tplId: tpl.id,
    name: tpl.name,
    rarity: tpl.rarity,
    rarityName: RARITY_META[tpl.rarity]?.name || '普通',
    level: tpl.level || 0,
    /** 弹药以发数计量，count 即发数 */
    count: n,
    value: Math.round(nonNeg(tpl.valuePerRound, 0) * n * (1 + nonNeg(valueBonus, 0)))
  };
}

/** 材料掉落：来自全地图共通的基础池 */
function makeMaterialLoot(maxRarity, valueBonus) {
  const allowed = new Set(mapMaterialPool());
  const rarity = rollRarityUpTo(maxRarity);
  let pool = MATERIAL_TEMPLATES.filter((t) => allowed.has(t.id) && t.rarity === rarity);
  if (!pool.length) pool = MATERIAL_TEMPLATES.filter((t) => allowed.has(t.id));
  const tpl = pick(pool);
  if (!tpl) return null;
  return makeLootEntry(tpl, LOOT_KIND.MATERIAL, randInt(1, 3), valueBonus);
}

/**
 * 收藏品掉落：只能从当前地图的专属池中产出
 * 例如「反应堆冷却核心」只在 AZ3 的红色池中，别的地图永远不会掉
 */
export function rollCollectibleRarity(maxRarity, redWeightBonus = 0) {
  const capTier = RARITY_META[maxRarity]?.tier || 1;

  const candidates = [];
  if (capTier >= RARITY_META[RARITY.RED].tier) {
    candidates.push({
      rarity: RARITY.RED,
      weight: 12 * (1 + Math.min(0.5, nonNeg(redWeightBonus, 0)))
    });
  }
  if (capTier >= RARITY_META[RARITY.LEGEND].tier) {
    candidates.push({ rarity: RARITY.LEGEND, weight: 88 });
  }
  if (!candidates.length) return null;

  const weights = {};
  candidates.forEach((c) => { weights[c.rarity] = c.weight; });
  return weightedPick(weights) || RARITY.LEGEND;
}

function makeCollectibleLoot(maxRarity, valueBonus, mapId = currentMapId(), redWeightBonus = 0) {
  if (!mapId) return null;
  // 红色需要箱体/击杀档位达到红色，否则只能出金色。
  const rarity = rollCollectibleRarity(maxRarity, redWeightBonus);
  if (!rarity) return null;

  const ids = mapCollectiblePool(mapId, rarity);
  if (!ids.length) return null;
  const tpl = getCollectible(pick(ids));
  if (!tpl) return null;
  return makeLootEntry(tpl, LOOT_KIND.COLLECTIBLE, 1, valueBonus);
}

function makeHafLoot(range, valueBonus) {
  const amount = Math.round(randInt(range[0], range[1]) * (1 + nonNeg(valueBonus, 0)));
  return {
    uid: uid('loot'),
    kind: LOOT_KIND.HAF,
    tplId: 'hafCoin',
    name: '哈夫币',
    rarity: RARITY.COMMON,
    rarityName: '货币',
    level: 0,
    count: amount,
    value: amount
  };
}

/**
 * 生成补给箱战利品
 * @returns {Array} loot 列表
 */
export function rollCrateLoot(crateConf, lootBonus = 0, redWeightBonus = 0) {
  const conf = crateConf || CRATE_TIERS[1];
  const out = [];
  const rolls = Math.max(1, conf.rolls);
  for (let i = 0; i < rolls; i += 1) {
    const kind = weightedPick(LOOT_TYPE_WEIGHTS) || LOOT_KIND.HAF;
    let item = null;
    if (kind === LOOT_KIND.HAF) item = makeHafLoot(conf.hafCoin, lootBonus);
    else if (kind === LOOT_KIND.MATERIAL) item = makeMaterialLoot(conf.rarity, lootBonus);
    else if (kind === LOOT_KIND.AMMO) item = makeAmmoLoot(conf.rarity, lootBonus);
    else item = makeEquipmentLoot(conf.rarity, lootBonus);
    if (item) out.push(item);
  }
  // 高档补给箱有机会额外产出该地图专属收藏品，档位越高概率越大
  const colChance = Math.max(0, (Math.max(1, conf.rolls) - 1)) * 0.06 + 0.04;
  if (Math.random() < colChance) {
    const col = makeCollectibleLoot(conf.rarity, lootBonus, currentMapId(), redWeightBonus);
    if (col) out.push(col);
  }
  return out;
}

/**
 * 生成击杀战利品；Boss 必定掉落装备（需求 10.8）
 * @param {object} opts { isBoss, isElite, isOperator, carried }
 *   carried 为敌方干员随机携带的装备，击杀后全部归我方
 */
export function rollKillLoot(lootTier, opts = {}, lootBonus = 0, redWeightBonus = 0) {
  const { isBoss = false, isElite = false, isOperator = false, carried = [] } = opts;
  const out = [];

  let hafRange = [90, 320];
  if (isBoss) hafRange = [1400, 3600];
  else if (isOperator) hafRange = [420, 1200];
  else if (isElite) hafRange = [200, 600];
  out.push(makeHafLoot(hafRange, lootBonus));

  // 敌方干员：击杀后可获得其全部随机携带物品
  if (isOperator && Array.isArray(carried)) {
    carried.forEach((tplId) => {
      // 弹药已不是装备模板，需单独按发缴获
      const ammoTpl = getAmmo(tplId);
      if (ammoTpl) {
        const am = makeAmmoLoot(ammoTpl.rarity, lootBonus, randInt(20, 60));
        if (am) out.push(am);
        return;
      }
      const tpl = getTemplate(tplId);
      if (!tpl) return;
      out.push(makeLootEntry(tpl, LOOT_KIND.EQUIPMENT, 1, lootBonus));
    });
  }

  if (isBoss) {
    const eq = makeEquipmentLoot(lootTier, lootBonus);
    if (eq) out.push(eq);
    const mat = makeMaterialLoot(lootTier, lootBonus);
    if (mat) out.push(mat);
    const am = makeAmmoLoot(lootTier, lootBonus);
    if (am) out.push(am);
    if (Math.random() < 0.55) {
      const col = makeCollectibleLoot(lootTier, lootBonus, currentMapId(), redWeightBonus);
      if (col) out.push(col);
    }
    return out;
  }

  if (isOperator || isElite) {
    const mat = makeMaterialLoot(lootTier, lootBonus);
    if (mat) out.push(mat);
    if (Math.random() < (isOperator ? 0.45 : 0.3)) {
      const am = makeAmmoLoot(lootTier, lootBonus);
      if (am) out.push(am);
    }
    if (Math.random() < (isOperator ? 0.2 : 0.1)) {
      const col = makeCollectibleLoot(lootTier, lootBonus, currentMapId(), redWeightBonus);
      if (col) out.push(col);
    }
    return out;
  }

  const roll = Math.random();
  if (roll < 0.45) {
    const mat = makeMaterialLoot(lootTier, lootBonus);
    if (mat) out.push(mat);
  } else if (roll < 0.62) {
    const am = makeAmmoLoot(lootTier, lootBonus);
    if (am) out.push(am);
  } else if (roll < 0.7) {
    const eq = makeEquipmentLoot(lootTier, lootBonus);
    if (eq) out.push(eq);
  }
  return out;
}

/** 将战利品写入本轮携带物资 */
export function addToCarry(lootList, s = getState()) {
  const run = s.run;
  if (!run || !Array.isArray(lootList)) return 0;
  // 新行动在出发时锁定容量；旧存档无该字段时维持旧版不限容量，避免更新后丢失战利品。
  const capacity = Number.isFinite(run.bagCapacity)
    ? nonNeg(run.bagCapacity, 0)
    : Number.POSITIVE_INFINITY;
  run.carry.capacity = Number.isFinite(capacity) ? capacity : null;
  run.carry.overflow = 0;
  run.carry.lastAccepted = [];
  run.carry.lastRejected = [];
  let gained = 0;
  lootList.forEach((item) => {
    if (!item) return;
    const firstAcceptance = !item.uid || !run.carry.items.some((x) => x.uid === item.uid);
    const stackable = item.kind === LOOT_KIND.HAF
      || item.kind === LOOT_KIND.MATERIAL
      || item.kind === LOOT_KIND.AMMO;
    const same = stackable && run.carry.items.find(
      (x) => x.kind === item.kind && x.tplId === item.tplId
    );
    if (!same && run.carry.items.length >= capacity) {
      run.carry.overflow += 1;
      run.carry.lastRejected.push(item);
      return;
    }
    run.carry.lastAccepted.push(item);
    gained += nonNeg(item.value, 0);
    if (firstAcceptance) {
      if (item.rarity === RARITY.RED) addRunXp('loot', 100, s);
      else if (item.rarity === RARITY.LEGEND) addRunXp('loot', 20, s);
    }
    if (item.kind === LOOT_KIND.HAF) {
      run.carry.hafCoin = nonNeg(run.carry.hafCoin, 0) + nonNeg(item.count, 0);
      if (same) {
        same.count += nonNeg(item.count, 0);
        same.value += nonNeg(item.value, 0);
      } else run.carry.items.push(item);
    } else {
      // 材料与弹药按同类堆叠（弹药的 count 即发数）
      if (same) {
        same.count += nonNeg(item.count, 1);
        same.value += nonNeg(item.value, 0);
      } else {
        run.carry.items.push(item);
      }
    }
  });
  return gained;
}

/** 本轮携带物资累计价值（需求 2.6） */
export function carryValue(run) {
  if (!run) return 0;
  return run.carry.items.reduce((sum, it) => sum + nonNeg(it.value, 0), 0);
}

/** 本轮携带物资按类型分组统计 */
export function carrySummary(run) {
  const out = { hafCoin: 0, materials: [], equipment: [], ammo: [], collectibles: [], total: 0 };
  if (!run) return out;
  run.carry.items.forEach((it) => {
    out.total += nonNeg(it.value, 0);
    if (it.kind === LOOT_KIND.HAF) out.hafCoin += nonNeg(it.count, 0);
    else if (it.kind === LOOT_KIND.MATERIAL) out.materials.push(it);
    else if (it.kind === LOOT_KIND.AMMO) out.ammo.push(it);
    else if (it.kind === LOOT_KIND.COLLECTIBLE) out.collectibles.push(it);
    else out.equipment.push(it);
  });
  return out;
}

/** 战利品价值等级标注（需求 1.7） */
export function lootTierLabel(item) {
  if (!item) return '';
  if (item.kind === LOOT_KIND.HAF) return '货币';
  return RARITY_META[item.rarity]?.name || '普通';
}

export function lootKindLabel(item) {
  if (!item) return '';
  if (item.kind === LOOT_KIND.HAF) return '哈夫币';
  if (item.kind === LOOT_KIND.MATERIAL) return '材料';
  if (item.kind === LOOT_KIND.AMMO) return '弹药';
  if (item.kind === LOOT_KIND.COLLECTIBLE) return '收藏品';
  return '装备';
}

/** 校验战利品条目对应的模板仍然存在 */
export function isValidLoot(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.kind === LOOT_KIND.HAF) return nonNeg(item.count, 0) > 0;
  if (item.kind === LOOT_KIND.MATERIAL) return !!getMaterial(item.tplId);
  if (item.kind === LOOT_KIND.COLLECTIBLE) return !!getCollectible(item.tplId);
  if (item.kind === LOOT_KIND.AMMO) return !!getAmmo(item.tplId);
  if (item.kind === LOOT_KIND.EQUIPMENT) return !!getTemplate(item.tplId);
  return false;
}
