/**
 * 掉落池配置
 *
 * 分为两层：
 * 1. BASE_POOL   基础掉落池：所有地图共通，蓝色与紫色材料
 * 2. MAP_POOLS   地图专属掉落池：金色与红色物资绑定到特定战区，
 *                例如「反应堆冷却核心」只在 AZ3 掉落
 *
 * 只有出现在对应地图池中的物资，才有机会在该地图掉落。
 */

import { RARITY } from './equipment.js';

/** 基础掉落池：全地图共通（蓝 8 + 紫 8） */
export const BASE_POOL = {
  materials: [
    'm_can', 'm_caliper', 'm_fuel_low', 'm_fuel_bottle',
    'm_insignia', 'm_thermo', 'm_aramid', 'm_pirate_coin',
    'm_pe', 'm_thermal', 'm_ssd', 'm_ram',
    'm_gamepad', 'm_humidifier', 'm_cutlass', 'm_dressing'
  ],
  collectibles: []
};

/**
 * 各战区专属掉落池
 * gold / red 分别为该地图独占的金色与红色收藏品
 */
export const MAP_POOLS = {
  dam: {
    name: '零号大坝',
    gold: ['c_coffee', 'c_cable', 'c_pass'],
    red: ['c_bee_medic']
  },
  valley: {
    name: '长弓溪谷',
    gold: ['c_lens', 'c_crossbow'],
    red: ['c_africa_heart']
  },
  bakesh: {
    name: '巴克什',
    gold: ['c_asara_file', 'c_judgement', 'c_gazelle'],
    red: ['c_blue_plate', 'c_blue_censer']
  },
  space: {
    name: '航天基地',
    gold: ['c_server', 'c_radio', 'c_haf_file'],
    red: ['c_gpu', 'c_exp_data']
  },
  prison: {
    name: '潮汐监狱',
    gold: ['c_crossbow', 'c_pass'],
    red: ['c_ocean_tear']
  },
  az3: {
    name: 'AZ3',
    gold: ['c_fuel_rod', 'c_server'],
    red: ['c_reactor_core']
  }
};

/** 取某地图可掉落的收藏品 id 列表（按稀有度过滤） */
export function mapCollectiblePool(mapId, rarity) {
  const pool = MAP_POOLS[mapId];
  if (!pool) return [];
  if (rarity === RARITY.RED) return [...(pool.red || [])];
  if (rarity === RARITY.LEGEND) return [...(pool.gold || [])];
  return [];
}

/** 取某地图可掉落的材料 id 列表（材料为全地图共通） */
export function mapMaterialPool() {
  return [...BASE_POOL.materials];
}

/** 某件收藏品可以在哪些地图掉落（用于图鉴提示产地） */
export function sourceMapsOf(collectibleId) {
  const out = [];
  Object.entries(MAP_POOLS).forEach(([mapId, pool]) => {
    const all = [...(pool.gold || []), ...(pool.red || [])];
    if (all.includes(collectibleId)) out.push({ mapId, name: pool.name });
  });
  return out;
}
