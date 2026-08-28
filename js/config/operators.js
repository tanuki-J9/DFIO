/**
 * 干员配置：定位、稀有度、基础属性与协同效果
 *
 * 放出状态说明：
 * unlocked  true 表示玩家已持有，可直接编成
 * comingSoon true 表示该干员尚未放出（占位），列表中置灰并显示小锁，不可选定也不可招募
 *
 * 当前放出：突击-威龙、侦察-露娜、支援-蝶，其余均为未放出占位。
 * hidden     true 表示隐藏角色（如嘉豪），仅作展示，永不可选定、不可招募、不可解锁
 * 像素头像素材未到位前，avatar 字段留空，由 UI 层渲染程序化像素占位图。
 *
 * 技能说明：
 *   rolePassive 定位基础技能，同定位干员共享并已接入运行数值
 *   skills      干员专属技能，自动释放逻辑见 systems/operatorSkills.js
 *   注：专属技能已接入自动释放；蝶的复活大招使用逐干员 HP/倒地状态。
 */

import { RARITY } from './equipment.js';

export const ROLE = {
  ASSAULT: 'assault',
  SUPPORT: 'support',
  ENGINEER: 'engineer',
  SCOUT: 'scout'
};

export const ROLE_META = {
  [ROLE.ASSAULT]: { id: ROLE.ASSAULT, name: '突击', fullName: '突击手', icon: '⚔️', mark: '▲', bias: '攻击特长', desc: '正面火力核心，显著提升小队输出。' },
  [ROLE.SUPPORT]: { id: ROLE.SUPPORT, name: '支援', fullName: '支援位', icon: '➕', mark: '✚', bias: '生命特长', desc: '提供持续保障，拉高小队生存上限。' },
  [ROLE.ENGINEER]: { id: ROLE.ENGINEER, name: '工程', fullName: '工程兵', icon: '🔧', mark: '⬢', bias: '防御特长', desc: '强化防护与工事，降低受创损失。' },
  [ROLE.SCOUT]: { id: ROLE.SCOUT, name: '侦察', fullName: '侦察兵', icon: '👁️', mark: '◈', bias: '效率特长', desc: '擅长搜刮与脱离，加快节奏。' }
};

/** 干员列表的定位分组顺序（与参考排布一致：突击 / 支援 / 工程 / 侦察） */
export const ROLE_ORDER = [ROLE.ASSAULT, ROLE.SUPPORT, ROLE.ENGINEER, ROLE.SCOUT];

export const OPERATOR_MAX_LEVEL = 30;
export const SQUAD_LIMIT = 3;

/** 干员升级消耗（哈夫币），按当前等级线性递增 */
export const OPERATOR_UPGRADE_COST = { base: 200, perLevel: 140 };

/**
 * 定位基础技能（被动）：同一定位的干员共享，实际数值见 operatorSkills.js
 */
export const ROLE_PASSIVE = {
  [ROLE.SCOUT]: { name: '物资嗅觉', icon: '📦', desc: '提高搜刮到高品级物资的概率。' },
  [ROLE.ASSAULT]: { name: '强行突破', icon: '🥾', desc: '带队移动速度增加。' },
  [ROLE.SUPPORT]: { name: '战地急救', icon: '🚑', desc: '救助倒地干员的速度加快。' },
  [ROLE.ENGINEER]: { name: '未解密', icon: '🔧', desc: '该定位基础技能尚未解密。' }
};

/** 干员技能类型 */
export const SKILL_KIND = {
  NORMAL: 'normal',
  ULTIMATE: 'ultimate'
};

export const SKILL_KIND_META = {
  [SKILL_KIND.NORMAL]: { name: '普通技能', tag: '普通', tone: 'sky' },
  [SKILL_KIND.ULTIMATE]: { name: '大招', tag: '大招', tone: 'rust' }
};

/** 每级属性成长比例（相对基础属性） */
export const OPERATOR_LEVEL_GROWTH = 0.08;

/**
 * palette 为像素占位头像的配色（发色 / 衣着 / 肤色），素材到位后可整体替换为 avatar 图片
 */
export const OPERATORS = [
  // ===== 突击 =====
  {
    id: 'op_weilong', name: '威龙', role: ROLE.ASSAULT, rarity: RARITY.EPIC,
    atk: 68, hp: 420, def: 26, unlocked: true, comingSoon: false,
    quote: '把路清出来，剩下的交给我。',
    palette: { hair: '#3c2f24', suit: '#4a5a3c', skin: '#c69a72', gear: '#2b2f26' },
    skills: [
      {
        name: 'C4 炸药', kind: SKILL_KIND.NORMAL, slot: '普通 1', icon: '🧨',
        range: '近', desc: '投掷 C4 炸药，造成范围伤害。'
      },
      {
        name: '喷气背包', kind: SKILL_KIND.NORMAL, slot: '普通 2', icon: '🚀',
        range: '自身', desc: '启动喷气背包，带队完成一段额外位移。'
      },
      {
        name: '虎蹲炮', kind: SKILL_KIND.ULTIMATE, slot: '大招', icon: '💥',
        range: '范围', desc: '发射虎蹲炮，所有被命中的干员全部倒地 2 秒。'
      }
    ]
  },
  {
    id: 'op_assault_2', name: '未放出', role: ROLE.ASSAULT, rarity: RARITY.RARE,
    atk: 58, hp: 330, def: 16, unlocked: false, comingSoon: true,
    quote: '情报未解密。',
    palette: { hair: '#5a4a32', suit: '#6a6a52', skin: '#b8875f', gear: '#33342a' }
  },
  {
    id: 'op_assault_3', name: '未放出', role: ROLE.ASSAULT, rarity: RARITY.EPIC,
    atk: 74, hp: 450, def: 28, unlocked: false, comingSoon: true,
    quote: '情报未解密。',
    palette: { hair: '#2a2a30', suit: '#3a3f48', skin: '#a97b58', gear: '#22252b' }
  },
  {
    id: 'op_assault_4', name: '未放出', role: ROLE.ASSAULT, rarity: RARITY.LEGEND,
    atk: 104, hp: 560, def: 30, unlocked: false, comingSoon: true,
    quote: '情报未解密。',
    palette: { hair: '#8c3a2a', suit: '#4a3038', skin: '#d0a382', gear: '#2e2226' }
  },

  // ===== 支援 =====
  {
    id: 'op_die', name: '蝶', role: ROLE.SUPPORT, rarity: RARITY.EPIC,
    atk: 30, hp: 620, def: 22, unlocked: true, comingSoon: false,
    quote: '别死在我面前，我会生气。',
    palette: { hair: '#c9b072', suit: '#3f5348', skin: '#d6ac86', gear: '#26302a' },
    skills: [
      {
        name: '掩护烟雾', kind: SKILL_KIND.NORMAL, slot: '普通 1', icon: '💨',
        range: '单体', desc: '向队友投掷烟雾，覆盖 1 名干员，降低敌人命中该队友的概率。'
      },
      {
        name: '回血装置', kind: SKILL_KIND.NORMAL, slot: '普通 2', icon: '💚',
        range: '双体', desc: '放置回血装置，为血量最低的 2 名队友持续恢复生命。'
      },
      {
        name: '归队协议', kind: SKILL_KIND.ULTIMATE, slot: '大招', icon: '✨',
        range: '单体', desc: '队友倒地时释放，读条结束后将该队友复活。'
      }
    ]
  },
  {
    id: 'op_support_2', name: '未放出', role: ROLE.SUPPORT, rarity: RARITY.RARE,
    atk: 26, hp: 560, def: 20, unlocked: false, comingSoon: true,
    quote: '情报未解密。',
    palette: { hair: '#d8c58e', suit: '#46504a', skin: '#cfa47c', gear: '#282f2b' }
  },
  {
    id: 'op_support_3', name: '未放出', role: ROLE.SUPPORT, rarity: RARITY.LEGEND,
    atk: 46, hp: 780, def: 34, unlocked: false, comingSoon: true,
    quote: '情报未解密。',
    palette: { hair: '#a3552f', suit: '#3c4a52', skin: '#c99a74', gear: '#232a2e' }
  },

  // ===== 工程 =====
  {
    id: 'op_eng_1', name: '未放出', role: ROLE.ENGINEER, rarity: RARITY.RARE,
    atk: 34, hp: 480, def: 48, unlocked: false, comingSoon: true,
    quote: '情报未解密。',
    palette: { hair: '#2e241c', suit: '#5a5136', skin: '#8a5f3c', gear: '#2d2a1f' }
  },
  {
    id: 'op_eng_2', name: '未放出', role: ROLE.ENGINEER, rarity: RARITY.RARE,
    atk: 30, hp: 520, def: 52, unlocked: false, comingSoon: true,
    quote: '情报未解密。',
    palette: { hair: '#26221e', suit: '#4c5240', skin: '#a87950', gear: '#2a2c24' }
  },
  {
    id: 'op_eng_3', name: '未放出', role: ROLE.ENGINEER, rarity: RARITY.EPIC,
    atk: 26, hp: 720, def: 66, unlocked: false, comingSoon: true,
    quote: '情报未解密。',
    palette: { hair: '#1f1f22', suit: '#3a4038', skin: '#9c7350', gear: '#212420' }
  },
  {
    id: 'op_eng_4', name: '未放出', role: ROLE.ENGINEER, rarity: RARITY.EPIC,
    atk: 28, hp: 680, def: 60, unlocked: false, comingSoon: true,
    quote: '情报未解密。',
    palette: { hair: '#c2ab74', suit: '#4e5648', skin: '#d3aa84', gear: '#282e26' }
  },
  {
    id: 'op_eng_5', name: '未放出', role: ROLE.ENGINEER, rarity: RARITY.LEGEND,
    atk: 32, hp: 800, def: 74, unlocked: false, comingSoon: true,
    quote: '情报未解密。',
    palette: { hair: '#b8a882', suit: '#565e4e', skin: '#cba57e', gear: '#2b3128' }
  },

  // ===== 侦察 =====
  {
    id: 'op_luna', name: '露娜', role: ROLE.SCOUT, rarity: RARITY.EPIC,
    atk: 52, hp: 380, def: 20, unlocked: true, comingSoon: false,
    quote: '撤离通道，我来开。',
    palette: { hair: '#22242c', suit: '#3c4650', skin: '#cda07a', gear: '#20242a' },
    skills: [
      {
        name: '探测箭', kind: SKILL_KIND.NORMAL, slot: '普通 1', icon: '🏹',
        range: '中', desc: '时间到后自动释放，命中敌人可提前得知敌人存在，同时对其施加减疗。'
      },
      {
        name: '手榴弹', kind: SKILL_KIND.NORMAL, slot: '普通 2', icon: '💣',
        range: '近中', desc: '投掷手榴弹，造成范围伤害。'
      },
      {
        name: '远程探测箭', kind: SKILL_KIND.ULTIMATE, slot: '大招', icon: '🛰️',
        range: '极远', desc: '射出远程探测箭，探明范围内的敌人数量。'
      }
    ]
  },
  {
    id: 'op_scout_2', name: '未放出', role: ROLE.SCOUT, rarity: RARITY.RARE,
    atk: 44, hp: 350, def: 18, unlocked: false, comingSoon: true,
    quote: '情报未解密。',
    palette: { hair: '#d8d8d0', suit: '#40484e', skin: '#d2a984', gear: '#242a2e' }
  },
  {
    id: 'op_scout_3', name: '未放出', role: ROLE.SCOUT, rarity: RARITY.LEGEND,
    atk: 62, hp: 420, def: 24, unlocked: false, comingSoon: true,
    quote: '情报未解密。',
    palette: { hair: '#6a5a48', suit: '#4a4238', skin: '#bf8f68', gear: '#2a2620' }
  },

  // ===== 隐藏角色（仅展示，永不可选定 / 招募 / 解锁）=====
  {
    id: 'op_jiahao', name: '嘉豪', role: ROLE.ASSAULT, rarity: RARITY.LEGEND,
    atk: 0, hp: 0, def: 0, unlocked: false, comingSoon: false,
    hidden: true, unlockable: false,
    title: '不可解锁 · 隐藏角色',
    quote: '豪情在天！',
    intro: '豪情在天！击杀所有遇到的角色。',
    hiddenNote: '档案权限不足，该角色无法通过任何途径解锁或编成。',
    palette: { hair: '#1a1a1e', suit: '#2a2226', skin: '#b98a63', gear: '#8c3a2a' }
  }
];

export function getOperator(opId) {
  return OPERATORS.find((o) => o.id === opId) || null;
}

/** 该干员是否尚未放出（占位、不可选定、不可招募） */
export function isComingSoon(opId) {
  const cfg = getOperator(opId);
  return !!cfg && !!cfg.comingSoon;
}

/** 该干员是否为隐藏角色（仅展示，永不可解锁 / 编成） */
export function isHidden(opId) {
  const cfg = getOperator(opId);
  return !!cfg && !!cfg.hidden;
}

/** 隐藏角色列表，单独成区展示 */
export function hiddenOperators() {
  return OPERATORS.filter((o) => o.hidden);
}

/** 获取干员定位基础技能（被动） */
export function rolePassive(role) {
  return ROLE_PASSIVE[role] || null;
}

/** 获取干员专属技能列表（无技能时返回空数组） */
export function operatorSkills(opId) {
  const cfg = getOperator(opId);
  return Array.isArray(cfg?.skills) ? cfg.skills : [];
}

/** 按定位分组的干员列表，用于列表分行展示（隐藏角色不进入定位分组） */
export function operatorsByRole() {
  return ROLE_ORDER.map((role) => ({
    role,
    meta: ROLE_META[role],
    list: OPERATORS.filter((o) => o.role === role && !o.hidden)
  }));
}

/**
 * 定位协同：编成中同一定位达到 2 名及以上时激活
 * 效果为百分比修正，作用于战斗表现，绝不影响战备
 */
export const SYNERGY = {
  [ROLE.ASSAULT]: { name: '交叉火力', at2: { atk: 0.15 }, at3: { atk: 0.28 }, text: '小队攻击提升' },
  [ROLE.ENGINEER]: { name: '工事协同', at2: { def: 0.20 }, at3: { def: 0.36 }, text: '小队防御提升' },
  [ROLE.SUPPORT]: { name: '战地医疗', at2: { hp: 0.18 }, at3: { hp: 0.32 }, text: '小队生命提升' },
  [ROLE.SCOUT]: { name: '前哨侦察', at2: { scavenge: 0.15, extract: 0.10 }, at3: { scavenge: 0.28, extract: 0.18 }, text: '搜刮与撤离效率提升' }
};
