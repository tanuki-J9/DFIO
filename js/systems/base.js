/**
 * 特勤处基地升级事务。
 *
 * 校验阶段只读取状态并生成完整扣款计划；提交阶段在校验全部通过后一次性应用计划。
 */

import {
  COMMAND_CENTER_GATES,
  FACILITY,
  FACILITY_META,
  FACILITY_ORDER,
  RARITY,
  facilityCost,
  getCollectible,
  getMaterial,
  getTemplate
} from '../config/index.js';
import { getState, notify } from '../core/state.js';
import { nonNeg } from '../core/utils.js';
import { skillBonuses } from './skill.js';

const MAX_FACILITY_LEVEL = 10;

const SHOP_LEVEL_UNLOCKS = [
  { facilityLevel: 9, gearLevel: 6 },
  { facilityLevel: 6, gearLevel: 5 },
  { facilityLevel: 4, gearLevel: 4 },
  { facilityLevel: 2, gearLevel: 3 },
  { facilityLevel: 1, gearLevel: 2 }
];

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function storedCount(container, id) {
  const raw = container?.[id] ?? 0;
  return Number.isInteger(raw) && raw >= 0 ? raw : null;
}

function inventoryCount(id, s) {
  if (getMaterial(id)) return storedCount(s?.materials, id) ?? 0;
  if (getCollectible(id)) return storedCount(s?.collectibles, id) ?? 0;
  return 0;
}

function normalizedFacilityLevel(id, s) {
  const raw = s?.base?.facilities?.[id];
  if (!Number.isInteger(raw)) return 1;
  return Math.min(MAX_FACILITY_LEVEL, Math.max(1, raw));
}

function maxShopLevel(facilityLevel) {
  return SHOP_LEVEL_UNLOCKS.find((row) => facilityLevel >= row.facilityLevel)?.gearLevel || 2;
}

/** Permanent account bonuses derived from the current base facility levels. */
export function baseBonuses(s = getState()) {
  const commandCenterLevel = normalizedFacilityLevel(FACILITY.COMMAND_CENTER, s);
  const armoryLevel = normalizedFacilityLevel(FACILITY.ARMORY, s);
  const armorLevel = normalizedFacilityLevel(FACILITY.ARMOR, s);
  const storageLevel = normalizedFacilityLevel(FACILITY.STORAGE, s);
  const intelligenceLevel = normalizedFacilityLevel(FACILITY.INTELLIGENCE, s);
  const medicalLevel = normalizedFacilityLevel(FACILITY.MEDICAL, s);
  const mobilityLevel = normalizedFacilityLevel(FACILITY.MOBILITY, s);
  return {
    loadoutPresetSlots: [3, 6, 9]
      .filter((milestone) => commandCenterLevel >= milestone).length,
    eternalConstruction: commandCenterLevel >= 10,
    weaponDiscount: Math.min(0.2, armoryLevel * 0.02),
    armorDiscount: Math.min(0.2, armorLevel * 0.02),
    maxWeaponLevel: maxShopLevel(armoryLevel),
    maxArmorLevel: maxShopLevel(armorLevel),
    warehouseSlots: storageLevel * 10,
    safeboxSlots: [3, 6, 9].filter((milestone) => storageLevel >= milestone).length,
    batchSell: storageLevel >= 5,
    autoSort: storageLevel >= 8,
    scavengeSpeed: intelligenceLevel * 0.03,
    crateTier: intelligenceLevel * 0.02,
    previewNodes: intelligenceLevel >= 6 ? 2 : (intelligenceLevel >= 3 ? 1 : 0),
    markBoss: intelligenceLevel >= 9,
    redWeightBonus: intelligenceLevel >= 10 ? 0.25 : 0,
    medicalHealPct: Math.min(0.5, Number((medicalLevel * 0.05).toFixed(6))),
    medicalHpPct: Math.min(0.2, Number((medicalLevel * 0.02).toFixed(6))),
    medicalReviveSpeed: Math.min(0.4, Number((medicalLevel * 0.04).toFixed(6))),
    medicalExtraUses: [3, 6, 9].filter((milestone) => medicalLevel >= milestone).length,
    marchSpeed: Math.min(0.25, Number((mobilityLevel * 0.025).toFixed(6))),
    minNodeGap: mobilityLevel >= 3 ? 0.5 : 0.6,
    startPreviewNodes: mobilityLevel >= 6 ? 1 : 0,
    skipNormalEnemies: mobilityLevel >= 10 ? 2 : (mobilityLevel >= 9 ? 1 : 0)
  };
}

/** Facility and legacy skill healing bonuses share one hard cap. */
export function medicalHealBonus(s = getState(), facility = baseBonuses(s), skills = skillBonuses(s)) {
  return Math.min(0.5,
    nonNeg(facility?.medicalHealPct, 0) + nonNeg(skills.medicalHealPct, 0));
}

/**
 * Lock the equipped healing tactical item and all account bonuses for one run.
 * Multiple squad medkits unlock the same shared use pool rather than multiplying it.
 */
export function makeMedicalRunSnapshot(loadoutSnapshot, s = getState()) {
  const loadouts = loadoutSnapshot && typeof loadoutSnapshot === 'object'
    ? Object.values(loadoutSnapshot)
    : [];
  const healing = loadouts.reduce((found, slots) => {
    if (found || !slots?.tactical) return found;
    const instance = (s?.inventory || []).find((item) => item?.uid === slots.tactical);
    const template = instance ? getTemplate(instance.tplId) : null;
    return template?.healing || null;
  }, null);
  if (!healing) return { maxUses: 0, remainingUses: 0, healRatio: 0 };

  const facility = baseBonuses(s);
  const bonus = medicalHealBonus(s, facility);
  const maxUses = Math.max(0,
    Math.floor(nonNeg(healing.baseUses, 0)) + Math.floor(nonNeg(facility.medicalExtraUses, 0)));
  const healRatio = Number((nonNeg(healing.healRatio, 0) * (1 + bonus)).toFixed(6));
  return { maxUses, remainingUses: maxUses, healRatio };
}

/** Lock launch-only mobility charges and reconnaissance for one run. */
export function makeMobilityRunSnapshot(s = getState()) {
  const facility = baseBonuses(s);
  return {
    remainingSkips: Math.floor(nonNeg(facility.skipNormalEnemies, 0)),
    startPreviewNodes: Math.floor(nonNeg(facility.startPreviewNodes, 0))
  };
}

function pctText(ratio) {
  const value = Math.round(nonNeg(ratio, 0) * 1000) / 10;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function facilityEffectSnapshot(id, level, s) {
  const virtual = {
    ...s,
    base: {
      ...(s?.base || {}),
      facilities: { ...(s?.base?.facilities || {}), [id]: level }
    }
  };
  const bonus = baseBonuses(virtual);
  let rows = [];
  let summary = '';

  if (id === FACILITY.COMMAND_CENTER) {
    rows = [
      { key: 'presets', label: '配装预设', value: `${bonus.loadoutPresetSlots} 套` },
      { key: 'display', label: '满级展示', value: bonus.eternalConstruction ? '满级徽章 · 永恒建设' : '未解锁' }
    ];
    summary = `配装预设 ${bonus.loadoutPresetSlots} 套${bonus.eternalConstruction ? ' · 永恒建设' : ''}`;
  } else if (id === FACILITY.ARMORY) {
    rows = [
      { key: 'discount', label: '武器商店', value: `-${pctText(bonus.weaponDiscount)}` },
      { key: 'shop', label: '最高武器等级', value: `${bonus.maxWeaponLevel} 级` }
    ];
    summary = `武器商店 -${pctText(bonus.weaponDiscount)} · 最高 ${bonus.maxWeaponLevel} 级`;
  } else if (id === FACILITY.ARMOR) {
    rows = [
      { key: 'discount', label: '防具商店', value: `-${pctText(bonus.armorDiscount)}` },
      { key: 'shop', label: '最高防具等级', value: `${bonus.maxArmorLevel} 级` }
    ];
    summary = `防具商店 -${pctText(bonus.armorDiscount)} · 最高 ${bonus.maxArmorLevel} 级`;
  } else if (id === FACILITY.STORAGE) {
    const tools = [bonus.batchSell ? '批量出售' : '', bonus.autoSort ? '自动整理' : '']
      .filter(Boolean).join(' · ') || '未解锁';
    rows = [
      { key: 'warehouse', label: '永久仓库', value: `+${bonus.warehouseSlots} 格` },
      { key: 'safebox', label: '保险箱', value: `+${bonus.safeboxSlots} 格` },
      { key: 'tools', label: '仓储工具', value: tools }
    ];
    summary = `仓库 +${bonus.warehouseSlots} 格 · 保险箱 +${bonus.safeboxSlots} 格`;
  } else if (id === FACILITY.INTELLIGENCE) {
    const intel = [
      bonus.previewNodes ? `预览 ${bonus.previewNodes} 个节点` : '',
      bonus.markBoss ? '标记首领' : '',
      bonus.redWeightBonus ? '专属大红权重提升' : ''
    ].filter(Boolean).join(' · ') || '未解锁';
    rows = [
      { key: 'speed', label: '搜刮耗时', value: `-${pctText(bonus.scavengeSpeed)}` },
      { key: 'crate', label: '高级箱权重', value: `+${pctText(bonus.crateTier)}` },
      { key: 'intel', label: '节点情报', value: intel }
    ];
    summary = `搜刮耗时 -${pctText(bonus.scavengeSpeed)} · 高级箱 +${pctText(bonus.crateTier)}`;
  } else if (id === FACILITY.MEDICAL) {
    rows = [
      { key: 'heal', label: '治疗量', value: `+${pctText(bonus.medicalHealPct)}` },
      { key: 'hp', label: '小队生命', value: `+${pctText(bonus.medicalHpPct)}` },
      { key: 'revive', label: '普通救援速度', value: `+${pctText(bonus.medicalReviveSpeed)}` },
      { key: 'uses', label: '医疗道具次数', value: `+${bonus.medicalExtraUses} 次` }
    ];
    summary = `治疗量 +${pctText(bonus.medicalHealPct)} · 小队生命 +${pctText(bonus.medicalHpPct)}`;
  } else if (id === FACILITY.MOBILITY) {
    rows = [
      { key: 'speed', label: '节点行进', value: `+${pctText(bonus.marchSpeed)}` },
      { key: 'floor', label: '最低移动时间', value: `${bonus.minNodeGap} 秒` },
      { key: 'preview', label: '出发侦察', value: bonus.startPreviewNodes ? `+${bonus.startPreviewNodes} 个节点` : '未解锁' },
      { key: 'skip', label: '快速通过', value: bonus.skipNormalEnemies ? `${bonus.skipNormalEnemies} 次` : '未解锁' }
    ];
    summary = `节点行进 +${pctText(bonus.marchSpeed)} · 最低 ${bonus.minNodeGap} 秒`;
  }
  return { rows, summary };
}

function facilityGate(id, level, targetLevel, s) {
  if (targetLevel > MAX_FACILITY_LEVEL) {
    return { ok: false, type: 'maxed', required: MAX_FACILITY_LEVEL, current: level };
  }
  if (id === FACILITY.COMMAND_CENTER) {
    const required = COMMAND_CENTER_GATES[targetLevel - 1];
    const current = s?.commander?.level;
    return {
      ok: Number.isInteger(current) && current >= required,
      type: 'commander',
      required,
      current: Number.isInteger(current) ? current : 0
    };
  }
  const current = s?.base?.facilities?.[FACILITY.COMMAND_CENTER];
  return {
    ok: Number.isInteger(current) && current >= targetLevel,
    type: 'commandCenter',
    required: targetLevel,
    current: Number.isInteger(current) ? current : 0
  };
}

/**
 * Summarize flexible-pool availability with a small max-flow graph because IDs may
 * legally occur in more than one pool.
 */
function poolAssignmentStatus(counts, rows) {
  const ids = Object.keys(counts).filter((id) => counts[id] > 0);
  const source = 0;
  const firstId = 1;
  const firstRow = firstId + ids.length;
  const sink = firstRow + rows.length;
  const size = sink + 1;
  const capacity = Array.from({ length: size }, () => Array(size).fill(0));

  ids.forEach((id, index) => {
    const idNode = firstId + index;
    capacity[source][idNode] = counts[id];
    rows.forEach((row, rowIndex) => {
      if (row.ids.includes(id)) capacity[idNode][firstRow + rowIndex] = counts[id];
    });
  });
  rows.forEach((row, index) => {
    capacity[firstRow + index][sink] = row.count;
  });

  let flow = 0;
  while (true) {
    const parent = Array(size).fill(-1);
    parent[source] = source;
    const queue = [source];
    for (let cursor = 0; cursor < queue.length && parent[sink] < 0; cursor += 1) {
      const node = queue[cursor];
      for (let next = 0; next < size; next += 1) {
        if (parent[next] < 0 && capacity[node][next] > 0) {
          parent[next] = node;
          queue.push(next);
        }
      }
    }
    if (parent[sink] < 0) break;

    let amount = Number.POSITIVE_INFINITY;
    for (let node = sink; node !== source; node = parent[node]) {
      amount = Math.min(amount, capacity[parent[node]][node]);
    }
    for (let node = sink; node !== source; node = parent[node]) {
      capacity[parent[node]][node] -= amount;
      capacity[node][parent[node]] += amount;
    }
    flow += amount;
  }

  const totalRequired = rows.reduce((sum, row) => sum + row.count, 0);
  return {
    ready: flow === totalRequired,
    missing: totalRequired - flow,
    missingByRow: rows.map((_, index) => capacity[firstRow + index][sink])
  };
}

function poolAssignmentPossible(counts, rows) {
  return poolAssignmentStatus(counts, rows).ready;
}

function normalizePoolPicks(selections, rows) {
  const picks = selections?.poolPicks;
  if (!Array.isArray(picks)) {
    return { ok: false, msg: '请选择升级所需的材料池物品' };
  }

  const counts = {};
  for (const pick of picks) {
    if (!isRecord(pick) || typeof pick.tplId !== 'string'
      || !Number.isInteger(pick.count) || pick.count <= 0) {
      return { ok: false, msg: '材料池选择数据异常' };
    }
    counts[pick.tplId] = (counts[pick.tplId] || 0) + pick.count;
  }

  const required = rows.reduce((sum, row) => sum + row.count, 0);
  const selected = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (selected !== required) {
    return { ok: false, msg: `材料池必须恰好选择 ${required} 件，当前选择 ${selected} 件` };
  }
  if (!poolAssignmentPossible(counts, rows)) {
    return { ok: false, msg: '材料池选择必须精确满足每项允许物品与数量' };
  }
  return { ok: true, counts };
}

function addDebit(target, id, count) {
  target[id] = (target[id] || 0) + count;
}

function invalidStateMessage(s) {
  if (!isRecord(s) || !isRecord(s.currency) || !isRecord(s.materials)
    || !isRecord(s.collectibles) || !isRecord(s.commander)
    || !isRecord(s.base) || !isRecord(s.base.facilities)) {
    return '基地或仓库状态异常，无法升级';
  }
  return '';
}

/** First held copy of a red collectible is protected. */
export function protectedCollectibleCount(id, s = getState()) {
  const tpl = getCollectible(id);
  const have = storedCount(s?.collectibles, id);
  if (!tpl || tpl.rarity !== RARITY.RED || have === null || have <= 0) return 0;
  return 1;
}

/** Red collectibles expose duplicates only; other collectibles remain fully consumable. */
export function consumableCollectibleCount(id, s = getState()) {
  const have = storedCount(s?.collectibles, id);
  if (have === null) return 0;
  return Math.max(0, have - protectedCollectibleCount(id, s));
}

/**
 * Purely validate one next-level upgrade and return an aggregated debit plan.
 */
export function validateFacilityUpgrade(id, selections, s = getState()) {
  if (!FACILITY_ORDER.includes(id)) return { ok: false, msg: '设施不存在' };
  const stateError = invalidStateMessage(s);
  if (stateError) return { ok: false, msg: stateError };

  const level = s.base.facilities[id];
  if (!Number.isInteger(level) || level < 1 || level > MAX_FACILITY_LEVEL) {
    return { ok: false, msg: '设施等级数据异常，无法升级' };
  }
  if (level >= MAX_FACILITY_LEVEL) {
    return { ok: false, msg: `${FACILITY_META[id].name} 已达等级上限` };
  }

  const targetLevel = level + 1;
  const gate = facilityGate(id, level, targetLevel, s);
  if (!gate.ok) {
    if (gate.type === 'commander') {
      return { ok: false, msg: `指挥官达到 ${gate.required} 级后才能升级指挥中心` };
    }
    return { ok: false, msg: `指挥中心达到 ${gate.required} 级后才能升级该设施` };
  }

  const cost = facilityCost(id, targetLevel);
  if (!cost) return { ok: false, msg: '设施升级费用数据异常' };
  const poolRows = cost.items.filter((row) => row.kind === 'pool');
  const selected = normalizePoolPicks(selections, poolRows);
  if (!selected.ok) return selected;

  const hafCoin = s.currency.hafCoin;
  if (!Number.isFinite(hafCoin) || hafCoin < 0) {
    return { ok: false, msg: '货币状态异常，无法升级' };
  }
  if (hafCoin < cost.hafCoin) {
    return { ok: false, msg: `哈夫币不足，还缺 ${Math.ceil(cost.hafCoin - hafCoin)}` };
  }

  const materials = {};
  const collectibles = {};
  for (const [tplId, count] of Object.entries(selected.counts)) {
    if (getMaterial(tplId)) addDebit(materials, tplId, count);
    else if (getCollectible(tplId)) addDebit(collectibles, tplId, count);
    else return { ok: false, msg: `升级物品 ${tplId} 数据异常` };
  }

  const protectedIds = new Set();
  for (const row of cost.items.filter((item) => item.kind === 'collectible')) {
    if (!getCollectible(row.id) || !Number.isInteger(row.count) || row.count <= 0) {
      return { ok: false, msg: '指定收藏品费用数据异常' };
    }
    addDebit(collectibles, row.id, row.count);
    if (row.protectFirst) protectedIds.add(row.id);
  }

  for (const [tplId, count] of Object.entries(materials)) {
    const have = storedCount(s.materials, tplId);
    if (have === null) return { ok: false, msg: `${getMaterial(tplId)?.name || tplId} 库存数据异常` };
    if (have < count) {
      return { ok: false, msg: `${getMaterial(tplId)?.name || tplId} 不足，还缺 ${count - have}` };
    }
  }

  for (const [tplId, count] of Object.entries(collectibles)) {
    const tpl = getCollectible(tplId);
    const have = storedCount(s.collectibles, tplId);
    if (have === null) return { ok: false, msg: `${tpl?.name || tplId} 库存数据异常` };
    const protectedCount = protectedIds.has(tplId) && have > 0 ? 1 : 0;
    const available = Math.max(0, have - protectedCount);
    if (available < count) {
      const qualifier = protectedIds.has(tplId) ? '可消耗重复数量' : '库存';
      return { ok: false, msg: `${tpl?.name || tplId}${qualifier}不足，还缺 ${count - available}` };
    }
  }

  return {
    ok: true,
    plan: {
      facilityId: id,
      fromLevel: level,
      targetLevel,
      hafCoin: cost.hafCoin,
      materials,
      collectibles
    }
  };
}

function availablePoolCounts(rows, s) {
  const ids = [...new Set(rows.flatMap((row) => row.ids))];
  return Object.fromEntries(ids.map((id) => [id, inventoryCount(id, s)]));
}

/** View model for the current level and its next upgrade. */
export function facilityUpgradeView(id, s = getState()) {
  const meta = FACILITY_META[id];
  if (!meta) return null;
  const rawLevel = s?.base?.facilities?.[id];
  const level = Number.isInteger(rawLevel) ? rawLevel : 1;
  const maxed = level >= MAX_FACILITY_LEVEL;
  const targetLevel = maxed ? null : level + 1;
  const cost = maxed ? null : facilityCost(id, targetLevel);
  const gate = maxed
    ? { ok: false, type: 'maxed', required: MAX_FACILITY_LEVEL, current: level }
    : facilityGate(id, level, targetLevel, s);
  const availableCoin = Number.isFinite(s?.currency?.hafCoin) ? Math.max(0, s.currency.hafCoin) : 0;
  const poolRows = cost?.items.filter((row) => row.kind === 'pool') || [];
  const pools = poolRows.map((row) => ({
    ids: [...row.ids],
    required: row.count,
    available: Object.fromEntries(row.ids.map((tplId) => [tplId, inventoryCount(tplId, s)]))
  }));
  const collectibles = (cost?.items.filter((row) => row.kind === 'collectible') || []).map((row) => {
    const have = storedCount(s?.collectibles, row.id) ?? 0;
    const protectedCount = row.protectFirst && have > 0 ? 1 : 0;
    const consumable = Math.max(0, have - protectedCount);
    return {
      id: row.id,
      required: row.count,
      protectFirst: !!row.protectFirst,
      owned: have,
      protected: protectedCount,
      consumable,
      missing: Math.max(0, row.count - consumable)
    };
  });
  const poolCounts = availablePoolCounts(poolRows, s);
  const poolStatus = poolAssignmentStatus(poolCounts, poolRows);
  const poolsReady = poolStatus.ready;
  const collectiblesReady = collectibles.every((row) => row.missing === 0);
  const currency = {
    required: cost?.hafCoin || 0,
    available: availableCoin,
    missing: Math.max(0, (cost?.hafCoin || 0) - availableCoin)
  };
  const currentEffects = facilityEffectSnapshot(id, level, s);
  const nextEffects = maxed ? null : facilityEffectSnapshot(id, targetLevel, s);
  const effects = currentEffects.rows.map((row) => ({
    ...row,
    next: nextEffects?.rows.find((candidate) => candidate.key === row.key)?.value || null
  }));

  return {
    ...meta,
    level,
    maxLevel: MAX_FACILITY_LEVEL,
    targetLevel,
    maxed,
    cost,
    gate,
    currentEffect: currentEffects.summary,
    effects,
    currency,
    pools,
    poolMissing: poolStatus.missing,
    poolMissingByRow: poolStatus.missingByRow,
    collectibles,
    canUpgrade: !maxed && gate.ok && currency.missing === 0 && poolsReady && collectiblesReady
  };
}

/** Apply a previously validated next-level upgrade atomically. */
export function upgradeFacility(id, selections, s = getState()) {
  const validation = validateFacilityUpgrade(id, selections, s);
  if (!validation.ok) return validation;
  const { plan } = validation;

  s.currency.hafCoin -= plan.hafCoin;
  Object.entries(plan.materials).forEach(([tplId, count]) => {
    const next = s.materials[tplId] - count;
    if (next > 0) s.materials[tplId] = next;
    else delete s.materials[tplId];
  });
  Object.entries(plan.collectibles).forEach(([tplId, count]) => {
    const next = s.collectibles[tplId] - count;
    if (next > 0) s.collectibles[tplId] = next;
    else delete s.collectibles[tplId];
  });
  s.base.facilities[id] = plan.targetLevel;
  notify();

  return {
    ok: true,
    msg: `${FACILITY_META[id].name} 已提升至 Lv.${plan.targetLevel}`,
    level: plan.targetLevel,
    plan
  };
}
