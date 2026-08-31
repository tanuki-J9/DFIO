/**
 * 指挥官与特勤处基地的静态成长配置。
 *
 * 配置在模块加载时深度冻结；运行时只保存等级和经验，绝不修改这些数值表。
 */

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const FACILITY = deepFreeze({
  COMMAND_CENTER: 'commandCenter',
  ARMORY: 'armory',
  ARMOR: 'armor',
  STORAGE: 'storage',
  INTELLIGENCE: 'intelligence',
  MEDICAL: 'medical',
  MOBILITY: 'mobility'
});

export const FACILITY_ORDER = deepFreeze([
  FACILITY.COMMAND_CENTER,
  FACILITY.ARMORY,
  FACILITY.ARMOR,
  FACILITY.STORAGE,
  FACILITY.INTELLIGENCE,
  FACILITY.MEDICAL,
  FACILITY.MOBILITY
]);

const BLUE_MATERIAL_IDS = [
  'm_can', 'm_caliper', 'm_fuel_low', 'm_fuel_bottle',
  'm_insignia', 'm_thermo', 'm_aramid', 'm_pirate_coin'
];

export const FACILITY_META = deepFreeze({
  [FACILITY.COMMAND_CENTER]: {
    id: FACILITY.COMMAND_CENTER,
    name: '指挥中心',
    icon: '⌘',
    purpleIds: ['m_ssd', 'm_ram'],
    goldIds: ['c_pass', 'c_server']
  },
  [FACILITY.ARMORY]: {
    id: FACILITY.ARMORY,
    name: '军械台',
    icon: '⚙',
    purpleIds: ['m_cutlass', 'm_pe'],
    goldIds: ['c_judgement', 'c_crossbow']
  },
  [FACILITY.ARMOR]: {
    id: FACILITY.ARMOR,
    name: '防具台',
    icon: '⬡',
    purpleIds: ['m_aramid', 'm_dressing'],
    goldIds: ['c_gazelle', 'c_cable']
  },
  [FACILITY.STORAGE]: {
    id: FACILITY.STORAGE,
    name: '仓储中心',
    icon: '▣',
    purpleIds: ['m_fuel_low', 'm_fuel_bottle'],
    goldIds: ['c_cable', 'c_coffee']
  },
  [FACILITY.INTELLIGENCE]: {
    id: FACILITY.INTELLIGENCE,
    name: '情报中心',
    icon: '◉',
    purpleIds: ['m_ssd', 'm_thermal'],
    goldIds: ['c_haf_file', 'c_asara_file']
  },
  [FACILITY.MEDICAL]: {
    id: FACILITY.MEDICAL,
    name: '医疗中心',
    icon: '✚',
    purpleIds: ['m_dressing', 'm_humidifier'],
    goldIds: ['c_coffee', 'c_pass']
  },
  [FACILITY.MOBILITY]: {
    id: FACILITY.MOBILITY,
    name: '机动中心',
    icon: '➜',
    purpleIds: ['m_fuel_low', 'm_fuel_bottle', 'm_pe'],
    goldIds: ['c_fuel_rod', 'c_cable']
  }
});

/** 每一级指挥官升级所需经验：索引 0 对应从 1 级升至 2 级。 */
export const COMMANDER_XP_PER_LEVEL = deepFreeze([
  500, 500, 500, 500,
  1200, 1200, 1200, 1200, 1200,
  2500, 2500, 2500, 2500, 2500,
  5000, 5000, 5000, 5000, 5000,
  9000, 9000, 9000, 9000, 9000,
  15000, 15000, 15000, 15000, 15000
]);

/** 索引 0–9 分别对应指挥中心 1–10 级所需的指挥官等级。 */
export const COMMAND_CENTER_GATES = deepFreeze([1, 3, 6, 9, 12, 15, 18, 21, 25, 30]);

const COST_SCHEDULE = [
  { hafCoin: 25000, blue: 3 },
  { hafCoin: 60000, blue: 3, purple: 1 },
  { hafCoin: 150000, purple: 2 },
  { hafCoin: 350000, purple: 3, gold: 1 },
  { hafCoin: 700000, purple: 4, gold: 1 },
  { hafCoin: 1500000, purple: 4, gold: 2 },
  { hafCoin: 3000000, purple: 5, gold: 3 },
  { hafCoin: 6000000, purple: 3, gold: 3, red: 1 },
  { hafCoin: 12000000, purple: 2, gold: 4, red: 2 }
];

const RED_COSTS = {
  [FACILITY.COMMAND_CENTER]: {
    9: [['c_blue_censer', 1]],
    10: [['c_blue_censer', 1], ['c_exp_data', 1]]
  },
  [FACILITY.ARMORY]: { 9: [['c_gpu', 1]], 10: [['c_gpu', 2]] },
  [FACILITY.ARMOR]: { 9: [['c_blue_plate', 1]], 10: [['c_blue_plate', 2]] },
  [FACILITY.STORAGE]: { 9: [['c_ocean_tear', 1]], 10: [['c_ocean_tear', 2]] },
  [FACILITY.INTELLIGENCE]: { 9: [['c_exp_data', 1]], 10: [['c_exp_data', 2]] },
  [FACILITY.MEDICAL]: { 9: [['c_bee_medic', 1]], 10: [['c_bee_medic', 2]] },
  [FACILITY.MOBILITY]: { 9: [['c_reactor_core', 1]], 10: [['c_reactor_core', 2]] }
};

function pool(ids, count) {
  return { kind: 'pool', ids, count };
}

function collectible(id, count) {
  return { kind: 'collectible', id, count, protectFirst: true };
}

function makeCost(facilityId, targetLevel) {
  const schedule = COST_SCHEDULE[targetLevel - 2];
  const meta = FACILITY_META[facilityId];
  const items = [];
  if (schedule.blue) items.push(pool(BLUE_MATERIAL_IDS, schedule.blue));
  if (schedule.purple) items.push(pool(meta.purpleIds, schedule.purple));
  if (schedule.gold) items.push(pool(meta.goldIds, schedule.gold));
  (RED_COSTS[facilityId][targetLevel] || []).forEach(([id, count]) => items.push(collectible(id, count)));
  return { hafCoin: schedule.hafCoin, items };
}

/**
 * Costs are indexed by target facility level: index 0 is level 2 and index 8 is level 10.
 * The free level-1 facilities deliberately have no cost row.
 */
export const FACILITY_COSTS = deepFreeze(Object.fromEntries(
  FACILITY_ORDER.map((facilityId) => [
    facilityId,
    Array.from({ length: 9 }, (_, index) => makeCost(facilityId, index + 2))
  ])
));

export function facilityCost(id, targetLevel) {
  const level = Number(targetLevel);
  if (!Number.isInteger(level) || level < 2 || level > 10) return null;
  return FACILITY_COSTS[id]?.[level - 2] || null;
}

export function commanderLevelForXp(totalXp) {
  let rest = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 1;
  while (level < 30 && rest >= COMMANDER_XP_PER_LEVEL[level - 1]) {
    rest -= COMMANDER_XP_PER_LEVEL[level - 1];
    level += 1;
  }
  return level;
}
