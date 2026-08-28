/**
 * 战斗、节点、战利品与全局运行参数
 */

import { RARITY } from './equipment.js';

/** 保险箱基础格数（可通过技能扩容） */
export const SAFEBOX_BASE_SLOTS = 3;

/** 战报保留条数上限 */
export const LOG_LIMIT = 60;

/** 演出区同屏特效上限 */
export const FX_LIMIT = 14;

/** 主循环 tick 间隔（毫秒），逻辑仍以时间戳差值为准 */
export const TICK_MS = 100;

/** 撤离相关 */
export const EXTRACTION = {
  baseDuration: 12,
  minDuration: 4,
  interruptWindow: 0.35,
  warnThresholdRatio: 0.2,
  warnThresholdMax: 25,
  debounceMs: 400
};

/** 交战结算间隔（秒） */
export const COMBAT = {
  tickInterval: 0.8,
  minTickInterval: 0.25,
  varianceRange: 0.18,
  defenseSoftCap: 800
};

/** 补给箱档位：搜刮耗时随稀有度提升 */
export const CRATE_TIERS = {
  1: { rarity: RARITY.COMMON, name: '普通补给箱', duration: 3.0, rolls: 1, hafCoin: [120, 320] },
  2: { rarity: RARITY.RARE, name: '军用弹药箱', duration: 4.5, rolls: 2, hafCoin: [320, 780] },
  3: { rarity: RARITY.EPIC, name: '密封保险柜', duration: 6.5, rolls: 3, hafCoin: [800, 1900] },
  4: { rarity: RARITY.LEGEND, name: '绝密物资柜', duration: 9.0, rolls: 4, hafCoin: [1800, 4200] },
  5: { rarity: RARITY.RED, name: 'AZ3 封存舱', duration: 11.0, rolls: 5, hafCoin: [3600, 8800] }
};

/** 补给箱稀有度分布：key 为地图分支 crateTier，value 为各档箱体权重 */
export const CRATE_DISTRIBUTION = {
  1: { 1: 72, 2: 24, 3: 4, 4: 0, 5: 0 },
  2: { 1: 48, 2: 38, 3: 12, 4: 2, 5: 0 },
  3: { 1: 26, 2: 40, 3: 26, 4: 8, 5: 0 },
  4: { 1: 12, 2: 30, 3: 34, 4: 20, 5: 4 },
  5: { 1: 4, 2: 18, 3: 32, 4: 30, 5: 16 }
};

/** 战利品构成权重：类型分布 */
export const LOOT_TYPE_WEIGHTS = { hafCoin: 40, material: 30, equipment: 16, ammo: 14 };

/** 初始资源 */
export const INITIAL = {
  hafCoin: 6000,
  deltaCoin: 120,
  equipment: [
    'w_ak', 'a_t3', 'h_t3', 'b_s', 't_med', 'w_m4', 'a_t4'
  ],
  /** 弹药按发储备：{ [ammoId]: 发数 } */
  ammo: { am_t2: 240, am_t3: 120 },
  materials: { m_can: 6, m_ssd: 2 }
};

/** 数值格式化阈值 */
export const FORMAT = { kThreshold: 100000 };
