/**
 * 敌方单位配置
 *
 * 三类敌人：
 * 1. 普通单位（NORMAL）  战力很弱，有装备基本都能打过
 * 2. 精英单位（ELITE）   战力稍强于普通单位
 * 3. 敌方干员（OPERATOR）1-3 人编队，拥有技能与随机装备，击杀后可获得其全部物品
 * 4. 最终 Boss（BOSS）   每张地图的终点单位
 *
 * 立绘：每张地图的敌方单位外观都不同，art 字段留空即使用占位色块，
 * 后续替换图片只需填 ENEMY_ART 中对应条目的 URL，无需改动逻辑。
 */

import { RARITY } from './equipment.js';

export const ENEMY_CLASS = {
  NORMAL: 'normal',
  ELITE: 'elite',
  OPERATOR: 'operator',
  BOSS: 'boss'
};

export const ENEMY_CLASS_META = {
  [ENEMY_CLASS.NORMAL]: { id: ENEMY_CLASS.NORMAL, name: '敌方单位', tag: '杂兵', tone: 'sand' },
  [ENEMY_CLASS.ELITE]: { id: ENEMY_CLASS.ELITE, name: '精英单位', tag: '精英', tone: 'amber' },
  [ENEMY_CLASS.OPERATOR]: { id: ENEMY_CLASS.OPERATOR, name: '敌方干员', tag: '干员', tone: 'violet' },
  [ENEMY_CLASS.BOSS]: { id: ENEMY_CLASS.BOSS, name: '最终目标', tag: 'BOSS', tone: 'rust' }
};

/**
 * 各战区敌方单位命名与立绘
 * art 为空字符串时演出层回落到占位色块；后期替换图片只改这里
 */
export const ENEMY_ART = {
  dam: {
    theme: 'dam',
    normal: { names: ['大坝巡逻兵', '闸口守卫', '散兵游勇'], art: '' },
    elite: { names: ['大坝重装兵', '闸室机枪手'], art: '' },
    operator: { names: ['「阀门」维克', '溪流猎手', '大坝拾荒者'], art: '' },
    boss: { names: ['据点指挥官·罗恩'], art: '' }
  },
  valley: {
    theme: 'valley',
    normal: { names: ['溪谷哨兵', '林线斥候', '流窜武装'], art: '' },
    elite: { names: ['长弓射手', '高地观测兵'], art: '' },
    operator: { names: ['「长弓」赫尔', '谷地游猎', '断线通讯员'], art: '' },
    boss: { names: ['「铁幕」队长'], art: '' }
  },
  bakesh: {
    theme: 'bakesh',
    normal: { names: ['巷道民兵', '尖塔守卫', '沙城劫掠者'], art: '' },
    elite: { names: ['阿萨拉卫队精锐', '尖塔狙击手'], art: '' },
    operator: { names: ['赛伊德的门徒', '沙城走私头目', '「弯刀」哈桑'], art: '' },
    boss: { names: ['格赫罗斯的执刑者'], art: '' }
  },
  space: {
    theme: 'space',
    normal: { names: ['基地保安', '发射场卫兵', '外围巡逻队'], art: '' },
    elite: { names: ['哈夫克重装卫队', '控制室守卫'], art: '' },
    operator: { names: ['哈夫克技术官', '「轨道」凯恩', '发射场督查'], art: '' },
    boss: { names: ['黑色行动指挥官'], art: '' }
  },
  prison: {
    theme: 'prison',
    normal: { names: ['牢区狱警', '潮汐看守', '越狱重犯'], art: '' },
    elite: { names: ['深海牢区督卫', '重刑区镇暴队'], art: '' },
    operator: { names: ['「潮涌」典狱长副官', '海牢清算人', '沉舰潜行者'], art: '' },
    boss: { names: ['重装督战官'], art: '' }
  },
  az3: {
    theme: 'az3',
    normal: { names: ['异化实验体', '污染区游荡者', '失控守卫'], art: '' },
    elite: { names: ['AZ3 强化异化体', '实验区镇压者'], art: '' },
    operator: { names: ['白衣研究员', '「样本」收容员', '污染区督导'], art: '' },
    boss: { names: ['AZ3 母体'], art: '' }
  }
};

export function getEnemyArt(mapId) {
  return ENEMY_ART[mapId] || ENEMY_ART.dam;
}

/**
 * 普通敌方单位档位：战力很弱，有装备基本都能打过
 * tier 对应地图分支的 enemyTier
 */
export const ENEMY_TIERS = {
  1: { name: '散兵', atk: 14, hp: 180, def: 4, level: 1, lootTier: RARITY.RARE },
  2: { name: '武装小队', atk: 26, hp: 380, def: 10, level: 2, lootTier: RARITY.RARE },
  3: { name: '雇佣兵', atk: 48, hp: 780, def: 22, level: 3, lootTier: RARITY.RARE },
  4: { name: '武装守卫', atk: 84, hp: 1500, def: 40, level: 4, lootTier: RARITY.EPIC },
  5: { name: '异化个体', atk: 140, hp: 2800, def: 68, level: 5, lootTier: RARITY.EPIC }
};

/** 同档敌人随机战斗侧重；机密以上不再每次生成完全相同的三围。 */
export const ENEMY_VARIANTS = {
  1: [{ id: 'standard', name: '标准', atkMul: 1, hpMul: 1, defMul: 1 }],
  2: [
    { id: 'raider', name: '突击型', atkMul: 1.18, hpMul: 0.92, defMul: 0.9 },
    { id: 'guard', name: '防卫型', atkMul: 0.92, hpMul: 1.14, defMul: 1.2 },
    { id: 'veteran', name: '老兵型', atkMul: 1.06, hpMul: 1.06, defMul: 1.06 }
  ],
  3: [
    { id: 'hunter', name: '猎手型', atkMul: 1.24, hpMul: 0.96, defMul: 0.92 },
    { id: 'heavy', name: '重装型', atkMul: 0.94, hpMul: 1.24, defMul: 1.28 },
    { id: 'tactical', name: '战术型', atkMul: 1.1, hpMul: 1.1, defMul: 1.12 }
  ],
  4: [
    { id: 'executioner', name: '处决型', atkMul: 1.32, hpMul: 1, defMul: 0.94 },
    { id: 'bulwark', name: '壁垒型', atkMul: 0.96, hpMul: 1.34, defMul: 1.36 },
    { id: 'specialist', name: '特战型', atkMul: 1.16, hpMul: 1.16, defMul: 1.18 }
  ],
  5: [
    { id: 'apex', name: '极限火力', atkMul: 1.42, hpMul: 1.05, defMul: 1 },
    { id: 'fortress', name: '移动堡垒', atkMul: 1, hpMul: 1.45, defMul: 1.46 },
    { id: 'mutant', name: '强化异变', atkMul: 1.24, hpMul: 1.25, defMul: 1.24 }
  ]
};

/** 精英单位：战力稍强于普通单位 */
export const ELITE_TIERS = {
  1: { atkMul: 1.5, hpMul: 1.8, defMul: 1.6, levelUp: 0, lootTier: RARITY.RARE },
  2: { atkMul: 1.55, hpMul: 1.9, defMul: 1.6, levelUp: 0, lootTier: RARITY.EPIC },
  3: { atkMul: 1.6, hpMul: 2.0, defMul: 1.7, levelUp: 0, lootTier: RARITY.EPIC },
  4: { atkMul: 1.65, hpMul: 2.1, defMul: 1.7, levelUp: 0, lootTier: RARITY.EPIC },
  5: { atkMul: 1.7, hpMul: 2.2, defMul: 1.8, levelUp: 0, lootTier: RARITY.LEGEND }
};

/** 精英单位出现概率（在普通交战节点中的占比） */
export const ELITE_CHANCE = { 1: 0.12, 2: 0.18, 3: 0.24, 4: 0.30, 5: 0.36 };

/** 敌方干员节点出现概率（在普通交战节点中的占比，优先级高于精英判定） */
export const OPERATOR_CHANCE = { 1: 0.08, 2: 0.12, 3: 0.18, 4: 0.24, 5: 0.30 };

/**
 * 敌方干员：1-3 人编队，拥有技能与随机装备
 * squadSize 为该档位可能的编队人数区间
 */
export const OPERATOR_TIERS = {
  1: { atkMul: 1.8, hpMul: 2.2, defMul: 1.8, levelUp: 0, squadSize: [1, 1], lootTier: RARITY.RARE },
  2: { atkMul: 1.9, hpMul: 2.4, defMul: 1.9, levelUp: 0, squadSize: [1, 2], lootTier: RARITY.EPIC },
  3: { atkMul: 2.0, hpMul: 2.6, defMul: 2.0, levelUp: 1, squadSize: [1, 2], lootTier: RARITY.EPIC },
  4: { atkMul: 2.1, hpMul: 2.8, defMul: 2.0, levelUp: 1, squadSize: [2, 3], lootTier: RARITY.LEGEND },
  5: { atkMul: 2.2, hpMul: 3.0, defMul: 2.1, levelUp: 1, squadSize: [2, 3], lootTier: RARITY.LEGEND }
};

/**
 * 敌方干员技能池
 * 均为被动效果，在交战开始时结算一次，不引入额外的回合制复杂度
 * kind 说明：
 *   tough      提高自身有效生命
 *   sharp      提高自身攻击
 *   plated     提高自身防御
 *   drain      每回合额外造成固定比例伤害
 *   evade      有概率完全闪避一次我方攻击
 */
export const ENEMY_SKILLS = [
  { id: 'es_tough', name: '战场老兵', kind: 'tough', value: 0.25, desc: '生命上限提升 25%' },
  { id: 'es_sharp', name: '精准射击', kind: 'sharp', value: 0.22, desc: '攻击提升 22%' },
  { id: 'es_plated', name: '复合镀层', kind: 'plated', value: 0.30, desc: '防御提升 30%' },
  { id: 'es_drain', name: '压制火力', kind: 'drain', value: 0.04, desc: '每回合额外造成我方生命上限 4% 的伤害' },
  { id: 'es_evade', name: '战术翻滚', kind: 'evade', value: 0.15, desc: '15% 概率完全闪避我方一次攻击' },
  { id: 'es_medic', name: '战地急救', kind: 'medic', value: 0.06, desc: '交战中每回合恢复 6% 最大生命，可被减疗压制' },
  { id: 'es_ap', name: '穿甲装填', kind: 'sharp', value: 0.30, desc: '攻击提升 30%' }
];

export function getEnemySkill(id) {
  return ENEMY_SKILLS.find((s) => s.id === id) || null;
}

/** 敌方干员可随机携带的装备槽位与各档位可用等级 */
export const ENEMY_GEAR_LEVELS = {
  1: [1, 2],
  2: [2, 3],
  3: [3, 4],
  4: [4, 5],
  5: [5, 6]
};

/** Boss 档位：强度与价值显著高于同档普通敌人，且必定掉落装备 */
export const BOSS_TIERS = {
  1: { name: '据点指挥官', atkMul: 3.0, hpMul: 5.0, defMul: 2.4, levelUp: 1, lootTier: RARITY.EPIC },
  2: { name: '重装督战官', atkMul: 3.2, hpMul: 5.6, defMul: 2.5, levelUp: 1, lootTier: RARITY.EPIC },
  3: { name: '「铁幕」队长', atkMul: 3.4, hpMul: 6.2, defMul: 2.6, levelUp: 1, lootTier: RARITY.LEGEND },
  4: { name: '黑色行动指挥官', atkMul: 3.6, hpMul: 6.8, defMul: 2.8, levelUp: 1, lootTier: RARITY.LEGEND },
  5: { name: 'AZ3 母体', atkMul: 4.0, hpMul: 7.6, defMul: 3.0, levelUp: 1, lootTier: RARITY.RED }
};
