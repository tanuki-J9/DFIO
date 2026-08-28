/**
 * 装备、槽位、稀有度与弹药配置
 */

export const RARITY = {
  COMMON: 'common',
  RARE: 'rare',
  EPIC: 'epic',
  LEGEND: 'legend',
  RED: 'red'
};

export const RARITY_META = {
  [RARITY.COMMON]: { id: RARITY.COMMON, name: '普通', tier: 1, cls: 'rar-common' },
  [RARITY.RARE]: { id: RARITY.RARE, name: '精良', tier: 2, cls: 'rar-rare' },
  [RARITY.EPIC]: { id: RARITY.EPIC, name: '史诗', tier: 3, cls: 'rar-epic' },
  [RARITY.LEGEND]: { id: RARITY.LEGEND, name: '传说', tier: 4, cls: 'rar-legend' },
  [RARITY.RED]: { id: RARITY.RED, name: '绝密', tier: 5, cls: 'rar-red' }
};

/** 稀有度从低到高的顺序，供抽取与比较使用 */
export const RARITY_ORDER = [
  RARITY.COMMON, RARITY.RARE, RARITY.EPIC, RARITY.LEGEND, RARITY.RED
];

export function rarityTier(rarity) {
  return RARITY_META[rarity]?.tier || 1;
}

export const SLOTS = [
  { id: 'weapon', name: '主武器', icon: '🔫' },
  { id: 'armor', name: '护甲', icon: '🛡️' },
  { id: 'helmet', name: '头盔', icon: '⛑️' },
  { id: 'bag', name: '背包', icon: '🎒' },
  { id: 'tactical', name: '战术道具', icon: '💠' }
];

export const SLOT_IDS = SLOTS.map((s) => s.id);

/* ============ 等级与穿透 ============ */

/** 装备等级上下限：武器 / 弹药 / 护甲 / 头盔 均为 1-6 级 */
export const GEAR_LEVEL = { min: 1, max: 6 };

/** 需要展示与参与穿透计算的等级槽位（弹药不占装备槽，单独按发携带） */
export const LEVELED_SLOTS = ['weapon', 'armor', 'helmet'];

export function clampGearLevel(lv) {
  const n = Math.round(Number(lv) || GEAR_LEVEL.min);
  return Math.min(GEAR_LEVEL.max, Math.max(GEAR_LEVEL.min, n));
}

/**
 * 穿透衰减表
 * key = 子弹等级 - 防具等级（差值），value = 伤害系数
 * 同级（0）打满额伤害；子弹等级低于防具时按差距递增衰减；
 * 子弹等级高于防具时略有超额收益，但收益远小于衰减惩罚。
 */
export const PENETRATION_TABLE = {
  5: 1.20,
  4: 1.16,
  3: 1.12,
  2: 1.08,
  1: 1.04,
  0: 1.00,
  '-1': 0.72,
  '-2': 0.50,
  '-3': 0.33,
  '-4': 0.20,
  '-5': 0.12
};

/** 无弹药可用时的最低伤害系数（仅技能可打，枪械停火） */
export const NO_AMMO_GUN_MULTIPLIER = 0;

/**
 * 取穿透系数
 * @param {number} ammoLevel  子弹等级 1-6
 * @param {number} armorLevel 防具等级 1-6
 */
export function penetrationMul(ammoLevel, armorLevel) {
  const diff = clampGearLevel(ammoLevel) - clampGearLevel(armorLevel);
  const key = String(diff);
  if (PENETRATION_TABLE[key] !== undefined) return PENETRATION_TABLE[key];
  return diff > 0 ? 1.20 : 0.12;
}

/**
 * 装备模板
 * value 即装备价值，直接计入战备（战备 = 装备价值总和）
 * atk / hp / def 为属性加成
 * level 为 1-6 级（武器/护甲/头盔），决定穿透与被穿透关系
 */
export const EQUIPMENT_TEMPLATES = [
  { id: 'w_ak', slot: 'weapon', name: 'AKM 突击步枪', rarity: RARITY.COMMON, level: 2, value: 320, atk: 24, hp: 0, def: 0, price: 480 },
  { id: 'w_m4', slot: 'weapon', name: 'M4A1 卡宾枪', rarity: RARITY.RARE, level: 3, value: 780, atk: 46, hp: 0, def: 2, price: 1150 },
  { id: 'w_sr', slot: 'weapon', name: 'SR-25 精确射手步枪', rarity: RARITY.EPIC, level: 4, value: 2100, atk: 92, hp: 0, def: 4, price: 3200 },
  { id: 'w_mg', slot: 'weapon', name: 'M250 通用机枪', rarity: RARITY.LEGEND, level: 5, value: 5400, atk: 168, hp: 40, def: 8, price: 8600 },
  { id: 'w_rail', slot: 'weapon', name: '「审判」电磁狙击枪', rarity: RARITY.RED, level: 6, value: 11200, atk: 286, hp: 60, def: 12, price: 17800 },

  { id: 'a_t2', slot: 'armor', name: '2 级战术背心', rarity: RARITY.COMMON, level: 2, value: 150, atk: 0, hp: 55, def: 8, price: 240 },
  { id: 'a_t3', slot: 'armor', name: '3 级复合防弹衣', rarity: RARITY.COMMON, level: 3, value: 260, atk: 0, hp: 90, def: 14, price: 400 },
  { id: 'a_t4', slot: 'armor', name: '4 级陶瓷插板甲', rarity: RARITY.RARE, level: 4, value: 700, atk: 0, hp: 180, def: 30, price: 1050 },
  { id: 'a_t5', slot: 'armor', name: '5 级重型防护甲', rarity: RARITY.EPIC, level: 5, value: 1950, atk: 4, hp: 380, def: 62, price: 2900 },
  { id: 'a_t6', slot: 'armor', name: '6 级外骨骼装甲', rarity: RARITY.LEGEND, level: 6, value: 5000, atk: 12, hp: 760, def: 118, price: 7900 },

  { id: 'h_t2', slot: 'helmet', name: 'PASGT 制式头盔', rarity: RARITY.COMMON, level: 2, value: 110, atk: 0, hp: 30, def: 6, price: 180 },
  { id: 'h_t3', slot: 'helmet', name: 'GT5 战术头盔', rarity: RARITY.COMMON, level: 3, value: 180, atk: 0, hp: 50, def: 10, price: 280 },
  { id: 'h_t4', slot: 'helmet', name: 'MHS 一体化头盔', rarity: RARITY.RARE, level: 4, value: 520, atk: 0, hp: 110, def: 22, price: 760 },
  { id: 'h_t5', slot: 'helmet', name: 'H90 重型防弹头盔', rarity: RARITY.EPIC, level: 5, value: 1400, atk: 0, hp: 230, def: 46, price: 2100 },
  { id: 'h_t6', slot: 'helmet', name: '「铁壁」全覆式头盔', rarity: RARITY.LEGEND, level: 6, value: 3600, atk: 6, hp: 470, def: 88, price: 5600 },

  { id: 'b_s', slot: 'bag', name: '轻型突击背包', rarity: RARITY.COMMON, value: 140, atk: 0, hp: 20, def: 2, price: 220 },
  { id: 'b_m', slot: 'bag', name: '战术模块背包', rarity: RARITY.RARE, value: 430, atk: 4, hp: 50, def: 6, price: 640 },
  { id: 'b_l', slot: 'bag', name: '远征大容量背包', rarity: RARITY.EPIC, value: 1180, atk: 8, hp: 110, def: 12, price: 1750 },
  { id: 'b_x', slot: 'bag', name: '「驮兽」超载背包', rarity: RARITY.LEGEND, value: 3100, atk: 16, hp: 220, def: 24, price: 4800 },

  { id: 't_med', slot: 'tactical', name: '急救包组', rarity: RARITY.COMMON, value: 120, atk: 0, hp: 60, def: 4, price: 200 },
  { id: 't_gre', slot: 'tactical', name: '高爆手雷组', rarity: RARITY.RARE, value: 380, atk: 22, hp: 0, def: 0, price: 580 },
  { id: 't_dro', slot: 'tactical', name: '侦察无人机', rarity: RARITY.EPIC, value: 1020, atk: 34, hp: 60, def: 8, price: 1600 },
  { id: 't_air', slot: 'tactical', name: '「雷霆」空袭信标', rarity: RARITY.LEGEND, value: 2800, atk: 96, hp: 100, def: 14, price: 4400 }
];

/**
 * 弹药类型
 * 弹药不是装备实例，而是按「发」计数的消耗资源，仓库中以 { [ammoId]: 发数 } 记录。
 *
 * level          子弹等级 1-6，与防具等级比较决定穿透衰减
 * pricePerRound  每一发的采购单价（哈夫币），买多少发付多少钱
 * valuePerRound  每一发的物资价值，仅用于战利品结算展示，不计入战备
 * atk            该弹种为枪械提供的攻击加成（携带即生效，与发数无关）
 */
export const AMMO_TEMPLATES = [
  { id: 'am_t1', name: '1 级民用弹', rarity: RARITY.COMMON, level: 1, pricePerRound: 2, valuePerRound: 1, atk: 0 },
  { id: 'am_t2', name: '2 级全被甲弹', rarity: RARITY.COMMON, level: 2, pricePerRound: 5, valuePerRound: 3, atk: 2 },
  { id: 'am_t3', name: '3 级钢芯弹', rarity: RARITY.RARE, level: 3, pricePerRound: 12, valuePerRound: 7, atk: 5 },
  { id: 'am_t4', name: '4 级穿甲弹', rarity: RARITY.EPIC, level: 4, pricePerRound: 28, valuePerRound: 17, atk: 9 },
  { id: 'am_t5', name: '5 级钨芯穿甲弹', rarity: RARITY.LEGEND, level: 5, pricePerRound: 65, valuePerRound: 40, atk: 14 },
  { id: 'am_t6', name: '6 级贫铀穿甲弹', rarity: RARITY.RED, level: 6, pricePerRound: 150, valuePerRound: 92, atk: 20 }
];

/** 商店与掉落的整发数档位，避免逐发点击 */
export const AMMO_PACK_SIZES = [30, 60, 120, 240];

/** 单次行动允许携带的弹药发数上限 */
export const AMMO_CARRY_MAX = 600;

export function getAmmo(ammoId) {
  return AMMO_TEMPLATES.find((t) => t.id === ammoId) || null;
}

export function isAmmoTemplate(ammoId) {
  return !!getAmmo(ammoId);
}

/** 装备模板查询：弹药已不是装备，故此处只含真正的装备 */
export function getTemplate(tplId) {
  return EQUIPMENT_TEMPLATES.find((t) => t.id === tplId) || null;
}

export function getSlotMeta(slotId) {
  return SLOTS.find((s) => s.id === slotId) || null;
}

/** 取模板等级，无等级概念的槽位回落为 0 */
export function templateLevel(tplId) {
  const tpl = getTemplate(tplId);
  if (!tpl) return 0;
  return LEVELED_SLOTS.includes(tpl.slot) ? clampGearLevel(tpl.level) : 0;
}

/**
 * 材料模板：仅作为战利品与商店商品存在，不参与战备
 * 蓝色（精良）与紫色（史诗）物资归入材料
 */
export const MATERIAL_TEMPLATES = [
  { id: 'm_can', name: '军用罐头', rarity: RARITY.RARE, value: 180, price: 260 },
  { id: 'm_caliper', name: '高精数显卡尺', rarity: RARITY.RARE, value: 240, price: 340 },
  { id: 'm_fuel_low', name: '低级燃料', rarity: RARITY.RARE, value: 200, price: 290 },
  { id: 'm_fuel_bottle', name: '便携燃料瓶', rarity: RARITY.RARE, value: 260, price: 380 },
  { id: 'm_insignia', name: '部队饰章', rarity: RARITY.RARE, value: 300, price: 430 },
  { id: 'm_thermo', name: '电子温度计', rarity: RARITY.RARE, value: 220, price: 320 },
  { id: 'm_aramid', name: '芳纶纤维', rarity: RARITY.RARE, value: 280, price: 400 },
  { id: 'm_pirate_coin', name: '古怪的海盗银币', rarity: RARITY.RARE, value: 340, price: 480 },

  { id: 'm_pe', name: '聚乙烯', rarity: RARITY.EPIC, value: 520, price: 760 },
  { id: 'm_thermal', name: '热像仪', rarity: RARITY.EPIC, value: 880, price: 1280 },
  { id: 'm_ssd', name: '固态硬盘', rarity: RARITY.EPIC, value: 700, price: 1020 },
  { id: 'm_ram', name: '内存条', rarity: RARITY.EPIC, value: 620, price: 900 },
  { id: 'm_gamepad', name: '手柄', rarity: RARITY.EPIC, value: 560, price: 820 },
  { id: 'm_humidifier', name: '输液加湿器', rarity: RARITY.EPIC, value: 660, price: 960 },
  { id: 'm_cutlass', name: '海盗弯刀', rarity: RARITY.EPIC, value: 940, price: 1360 },
  { id: 'm_dressing', name: '无菌敷料包', rarity: RARITY.EPIC, value: 580, price: 850 }
];

export function getMaterial(matId) {
  return MATERIAL_TEMPLATES.find((m) => m.id === matId) || null;
}
