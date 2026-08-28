/**
 * 战区地图与行动难度配置
 * 本阶段不定义平衡数值，此处数值仅为占位骨架，后续数值设计阶段可整体替换
 */

export const DIFFICULTY = {
  NORMAL: 'normal',
  SECRET: 'secret',
  TOP_SECRET: 'topSecret',
  ETERNAL: 'eternal'
};

export const DIFFICULTY_META = {
  [DIFFICULTY.NORMAL]: {
    id: DIFFICULTY.NORMAL,
    name: '普通行动',
    short: '普通',
    danger: 1,
    dangerText: '低危',
    color: 'sky',
    lootTier: 'T1',
    lootTierText: '基础物资',
    hasThreshold: false
  },
  [DIFFICULTY.SECRET]: {
    id: DIFFICULTY.SECRET,
    name: '机密行动',
    short: '机密',
    danger: 2,
    dangerText: '中危',
    color: 'amber',
    lootTier: 'T2',
    lootTierText: '优质物资',
    hasThreshold: true
  },
  [DIFFICULTY.TOP_SECRET]: {
    id: DIFFICULTY.TOP_SECRET,
    name: '绝密行动',
    short: '绝密',
    danger: 3,
    dangerText: '高危',
    color: 'rust',
    lootTier: 'T3',
    lootTierText: '稀有物资',
    hasThreshold: true
  },
  [DIFFICULTY.ETERNAL]: {
    id: DIFFICULTY.ETERNAL,
    name: '永恒行动',
    short: '永恒',
    danger: 4,
    dangerText: '极危',
    color: 'violet',
    lootTier: 'T4',
    lootTierText: '传说物资',
    hasThreshold: true
  }
};

export const DIFFICULTY_ORDER = [
  DIFFICULTY.NORMAL,
  DIFFICULTY.SECRET,
  DIFFICULTY.TOP_SECRET,
  DIFFICULTY.ETERNAL
];

/**
 * branch 字段说明：
 * readiness  最低战备要求（普通行动恒为 0，表示无门槛）
 * level      等级限制（0 表示无限制）
 * timeLimit  行动时限（秒）
 * nodeGap    节点间推进耗时（秒）
 * weights    节点权重表
 * art        该难度的战区实景图
 * rare       低概率出现的稀有目标提示
 */
function branch(difficulty, readiness, timeLimit, nodeGap, weights, enemyTier, crateTier, extra = {}) {
  return {
    difficulty,
    readiness,
    timeLimit,
    nodeGap,
    weights,
    enemyTier,
    crateTier,
    level: extra.level || 0,
    art: extra.art || '',
    rare: extra.rare || '低概率出现'
  };
}

/**
 * 战区地图底图（等距沙盘）
 * 各据点坐标为底图百分比，便于底图替换后统一微调
 */
export const MAP_BACKGROUND = 'https://assets.with.tencent.com/with/4c2e41d5-ff71-4423-9d5e-208c2318956e/862c488a73184da5920e05e5b5565417.png';

/**
 * 各战区实景封面图（用于作战准备的行动简报卡片）
 * 均为横向构图，便于按 16:9 裁切展示
 */
export const MAP_COVERS = {
  dam: 'https://assets.with.tencent.com/default/5f9a5154-5494-43d0-98b7-2a3c8c529b81/image_1787905763_1_1.jpg',
  valley: 'https://assets.with.tencent.com/default/02bf5342-2cf1-4823-9184-6b7566156b36/image_1787905765_2_1.jpg',
  bakesh: 'https://assets.with.tencent.com/default/cc7185c3-023f-49ea-ab6c-849805c89626/image_1787905767_3_1.png',
  space: 'https://assets.with.tencent.com/default/17966695-0af3-4243-8a10-ee5367cea8d4/image_1787905779_1_1.png',
  prison: 'https://assets.with.tencent.com/default/036a3728-c18f-44e1-b48e-35df33844696/image_1787905778_3_3.jpg',
  az3: 'https://assets.with.tencent.com/default/59330b12-bb4d-49ce-b6e8-352b019a5199/image_1787905786_3_1.jpg'
};

/** 取战区封面图，缺省回落到沙盘底图 */
export function getMapCover(mapId) {
  return MAP_COVERS[mapId] || MAP_BACKGROUND;
}

export const MAPS = [
  {
    id: 'dam',
    name: '零号大坝',
    subtitle: 'ZERO DAM',
    desc: '废弃水利枢纽，结构复杂，补给箱分布密集，是新任指挥官的首选战区。',
    theme: 'dam',
    /** 据点在底图上的位置（百分比） */
    spot: { x: 32.4, y: 19.5 },
    branches: [
      branch(DIFFICULTY.NORMAL, 0, 180, 4.0, { crate: 62, enemy: 34, boss: 4 }, 1, 1,
        { level: 0, rare: '低概率出现 · 黄金加密箱' }),
      branch(DIFFICULTY.SECRET, 112500, 150, 3.6, { crate: 52, enemy: 40, boss: 8 }, 2, 2,
        { level: 12, rare: '低概率出现 · 军工蓝图残页' }),
      branch(DIFFICULTY.ETERNAL, 1000000, 100, 2.8, { crate: 38, enemy: 44, boss: 18 }, 4, 4,
        { level: 30, rare: '低概率出现 · 大坝核心密钥' })
    ]
  },
  {
    id: 'valley',
    name: '长弓溪谷',
    subtitle: 'LONGBOW VALLEY',
    desc: '开阔溪谷地形，视野良好但缺乏掩体，交火频率显著高于大坝。',
    theme: 'valley',
    spot: { x: 8.5, y: 31.5 },
    branches: [
      branch(DIFFICULTY.NORMAL, 0, 170, 3.8, { crate: 58, enemy: 38, boss: 4 }, 1, 1,
        { level: 6, rare: '低概率出现 · 侦察兵遗物' }),
      branch(DIFFICULTY.SECRET, 112500, 145, 3.4, { crate: 48, enemy: 44, boss: 8 }, 2, 2,
        { level: 12, rare: '低概率出现 · 长弓观测数据' }),
      branch(DIFFICULTY.ETERNAL, 1000000, 95, 2.6, { crate: 34, enemy: 47, boss: 19 }, 4, 4,
        { level: 30, rare: '低概率出现 · 溪谷封锁令' })
    ]
  },
  {
    id: 'bakesh',
    name: '巴克什',
    subtitle: 'BAKESH',
    desc: '沙漠边境城镇，尖塔林立、巷道纵横，武装势力长期驻扎，仅开放机密与绝密两档行动。',
    theme: 'bakesh',
    spot: { x: 13.5, y: 62.5 },
    branches: [
      branch(DIFFICULTY.SECRET, 187500, 145, 3.4, { crate: 50, enemy: 42, boss: 8 }, 2, 2,
        { level: 15, rare: '低概率出现 · 走私商队清单' }),
      branch(DIFFICULTY.TOP_SECRET, 600000, 112, 2.9, { crate: 41, enemy: 45, boss: 14 }, 3, 3,
        { level: 30, rare: '低概率出现 · 尖塔军械库权限' })
    ]
  },
  {
    id: 'space',
    name: '航天基地',
    subtitle: 'SPACE PORT',
    desc: '高价值科研设施，全境处于武装管控之下，无低风险行动分支。',
    theme: 'space',
    spot: { x: 89.5, y: 63.5 },
    branches: [
      branch(DIFFICULTY.SECRET, 187500, 140, 3.4, { crate: 50, enemy: 41, boss: 9 }, 2, 2,
        { level: 18, rare: '低概率出现 · 推进器组件' }),
      branch(DIFFICULTY.TOP_SECRET, 600000, 115, 3.0, { crate: 42, enemy: 45, boss: 13 }, 3, 3,
        { level: 30, rare: '低概率出现 · 发射控制芯片' }),
      branch(DIFFICULTY.ETERNAL, 1000000, 90, 2.5, { crate: 32, enemy: 48, boss: 20 }, 4, 4,
        { level: 30, rare: '低概率出现 · 轨道武器图纸' })
    ]
  },
  {
    id: 'prison',
    name: '潮汐监狱',
    subtitle: 'TIDE PRISON',
    desc: '海上重刑设施，仅存在绝密与永恒两档行动，低战备小队无法进入。',
    theme: 'prison',
    spot: { x: 34.5, y: 75.5 },
    branches: [
      branch(DIFFICULTY.TOP_SECRET, 780000, 110, 2.9, { crate: 40, enemy: 45, boss: 15 }, 3, 3,
        { level: 33, rare: '低概率出现 · 重犯身份档案' }),
      branch(DIFFICULTY.ETERNAL, 1000000, 85, 2.4, { crate: 30, enemy: 48, boss: 22 }, 5, 5,
        { level: 30, rare: '低概率出现 · 深海牢区通行证' })
    ]
  },
  {
    id: 'az3',
    name: 'AZ3',
    subtitle: 'AZ-3 SECTOR',
    desc: '未登记实验区域，地形每次行动都不同，物资构成极不稳定。',
    theme: 'az3',
    spot: { x: 61.5, y: 76.5 },
    branches: [
      branch(DIFFICULTY.NORMAL, 0, 165, 3.7, { crate: 56, enemy: 39, boss: 5 }, 1, 2,
        { level: 9, rare: '低概率出现 · 异常样本瓶' }),
      branch(DIFFICULTY.SECRET, 112500, 135, 3.2, { crate: 46, enemy: 44, boss: 10 }, 3, 3,
        { level: 14, rare: '低概率出现 · 实验日志碎片' }),
      branch(DIFFICULTY.ETERNAL, 1000000, 80, 2.3, { crate: 28, enemy: 48, boss: 24 }, 5, 5,
        { level: 30, rare: '低概率出现 · AZ3 封存装置' })
    ]
  }
];

export function getMap(mapId) {
  return MAPS.find((m) => m.id === mapId) || null;
}

export function getBranch(mapId, difficulty) {
  const map = getMap(mapId);
  if (!map) return null;
  return map.branches.find((b) => b.difficulty === difficulty) || null;
}

/** 小队人数上限（编成最多 3 名干员） */
export const MAX_SQUAD = 3;

/** 有效小队人数：至少按 1 人计算，避免空编成时门槛归零 */
export function squadSize(squad) {
  const n = Array.isArray(squad) ? squad.filter(Boolean).length : 0;
  return Math.min(MAX_SQUAD, Math.max(1, n));
}

/** 实际准入价值 = 基准准入价值 × 出战人数 */
export function scaledReadiness(baseReadiness, squad) {
  const base = Number(baseReadiness) || 0;
  if (base <= 0) return 0;
  return base * squadSize(squad);
}

/** 该地图的最低进入门槛（用于整图不可进入判定，如潮汐监狱） */
export function getMapMinReadiness(map) {
  if (!map || !map.branches.length) return 0;
  return Math.min(...map.branches.map((b) => b.readiness));
}
