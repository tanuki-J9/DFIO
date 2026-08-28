/**
 * 核心状态层
 * 单一状态树 + 行动状态机 + 订阅通知机制
 * 渲染层只消费此处数据，禁止反向写入演出结果（技术约束 5）
 */

import { SLOT_IDS, SAFEBOX_BASE_SLOTS, LOG_LIMIT, INITIAL, getTemplate, getAmmo, AMMO_CARRY_MAX, getOperator, getCollectible } from '../config/index.js';
import { nonNeg, nonNegInt, num, uid, deepClone } from './utils.js';

/** 行动状态机枚举：准备 → 推进 → 搜刮 / 交战 → 撤离中 → 结算 */
export const PHASE = {
  PREPARE: 'prepare',
  MARCH: 'march',
  SCAVENGE: 'scavenge',
  COMBAT: 'combat',
  EXTRACTING: 'extracting',
  SETTLE: 'settle'
};

/** 合法状态迁移表 */
const TRANSITIONS = {
  [PHASE.PREPARE]: [PHASE.MARCH],
  [PHASE.MARCH]: [PHASE.SCAVENGE, PHASE.COMBAT, PHASE.EXTRACTING, PHASE.SETTLE],
  [PHASE.SCAVENGE]: [PHASE.MARCH, PHASE.EXTRACTING, PHASE.SETTLE],
  [PHASE.COMBAT]: [PHASE.MARCH, PHASE.EXTRACTING, PHASE.SETTLE],
  [PHASE.EXTRACTING]: [PHASE.MARCH, PHASE.COMBAT, PHASE.SETTLE],
  [PHASE.SETTLE]: [PHASE.PREPARE]
};

export const VIEW = { PREPARE: 'prepare', EXPLORE: 'explore' };

/** 失败原因 */
export const FAIL_REASON = { WIPED: 'wiped', TIMEOUT: 'timeout' };

function makeEquipInstance(tplId) {
  const tpl = getTemplate(tplId);
  if (!tpl) return null;
  return { uid: uid('eq'), tplId: tpl.id, slot: tpl.slot };
}

/** 生成一份空槽位表（单名干员的装备槽） */
export function emptySlots() {
  const slots = {};
  SLOT_IDS.forEach((id) => { slots[id] = null; });
  return slots;
}

/** 构造全新存档 */
export function createInitialState() {
  const inventory = [];
  INITIAL.equipment.forEach((tplId) => {
    const inst = makeEquipInstance(tplId);
    if (inst) inventory.push(inst);
  });

  return {
    version: 2,
    createdAt: Date.now(),
    savedAt: Date.now(),

    view: VIEW.PREPARE,
    activeTab: 'map',

    currency: { hafCoin: INITIAL.hafCoin, deltaCoin: INITIAL.deltaCoin },

    /** 永久仓库 */
    inventory,
    materials: { ...INITIAL.materials },

    /** 弹药储备：{ [ammoId]: 发数 }。弹药按发计数，不占装备槽、不计入战备 */
    ammo: { ...INITIAL.ammo },

    /** 出发时选定的弹种与携带发数 */
    ammoLoadout: { ammoId: 'am_t2', rounds: 240 },

    /** 仓库 · 收藏品：{ [collectibleId]: 数量 } */
    collectibles: {},

    /**
     * 收藏室图鉴：记录曾经获得过的条目（即使已出售也保留记录）
     * { [entryId]: { at: 时间戳, count: 累计获得次数 } }
     */
    gallery: {},

    /**
     * 每名干员各自的装备槽位：{ [opId]: { weapon: uid|null, ... } }
     * 同一件装备实例只能被一名干员占用
     */
    loadouts: {},

    /** 干员：解锁列表与上阵列表 */
    operators: {
      unlocked: [],
      levels: {},
      squad: []
    },

    /** 技能等级表 */
    skills: {},

    /** 保险箱：预存物品（出发前配置），撤离失败时仅此处保留 */
    safebox: { items: [] },

    /** 选中的行动 */
    selection: { mapId: null, difficulty: null },

    /** 本轮行动运行时；null 表示不在行动中 */
    run: null,

    /** 最近一次结算结果，用于结算弹窗 */
    lastSettlement: null,

    stats: { runs: 0, success: 0, wiped: 0, timeout: 0, kills: 0, crates: 0, totalLoot: 0 }
  };
}


/**
 * 将原有小队总生命拆成逐干员生命。
 * 当前阶段按干员快照基础 HP 占比分配本轮最终 maxHp，既兼容现有装备/协同总生命，
 * 又不需要在运行时反查已经被快照锁定的战前配置。
 */
function makeRunMembers(squadSnapshot, teamMaxHp, teamHp = teamMaxHp) {
  const squad = Array.isArray(squadSnapshot) ? squadSnapshot.filter(Boolean) : [];
  if (!squad.length) return [];
  const weights = squad.map((m) => Math.max(1, nonNeg(m?.hp, 1)));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || squad.length;
  const maxTotal = Math.max(squad.length, nonNeg(teamMaxHp, squad.length));
  const hpRatio = Math.min(1, Math.max(0, nonNeg(teamHp, maxTotal) / maxTotal));
  let assigned = 0;
  return squad.map((m, i) => {
    const maxHp = i === squad.length - 1
      ? Math.max(1, Math.round(maxTotal - assigned))
      : Math.max(1, Math.round(maxTotal * weights[i] / totalWeight));
    assigned += maxHp;
    return {
      id: String(m.id || `member_${i}`),
      name: String(m.name || m.id || `干员 ${i + 1}`),
      role: String(m.role || 'assault'),
      maxHp,
      hp: Math.max(0, Math.round(maxHp * hpRatio)),
      downed: false,
      downedAt: 0,
      revived: 0
    };
  });
}

/** 构造本轮行动运行时对象 */
export function createRun({ mapId, difficulty, timeLimit, startedAt, squadSnapshot, loadoutSnapshot, maxHp, nodeGap, ammo, armorLevel }) {
  return {
    id: uid('run'),
    mapId,
    difficulty,
    startedAt: num(startedAt, Date.now()),
    timeLimit: nonNeg(timeLimit, 60),
    endsAt: num(startedAt, Date.now()) + nonNeg(timeLimit, 60) * 1000,

    phase: PHASE.MARCH,
    /** 阶段计时：所有耗时逻辑均基于绝对时间戳 */
    phaseStartedAt: num(startedAt, Date.now()),
    phaseDuration: nonNeg(nodeGap, 3),

    squadSnapshot: deepClone(squadSnapshot) || [],
    loadoutSnapshot: deepClone(loadoutSnapshot) || {},

    maxHp: nonNeg(maxHp, 1),
    hp: nonNeg(maxHp, 1),
    /** 逐干员生命/倒地状态；run.hp 保留为汇总值供旧 UI 与结算兼容 */
    members: makeRunMembers(squadSnapshot, nonNeg(maxHp, 1)),

    /** 本轮弹药储备（按发）；打空后只能用技能攻击 */
    ammo: ammo && typeof ammo === 'object'
      ? { ...ammo }
      : { rounds: 0, maxRounds: 0, level: 0, ammoId: null, name: '无弹药', spent: 0 },

    /** 我方有效防护等级（护甲 / 头盔最高级），用于敌方子弹穿透计算 */
    armorLevel: Math.min(6, Math.max(1, nonNegInt(armorLevel, 1))),

    distance: 0,
    nodeIndex: 0,
    nodeGap: nonNeg(nodeGap, 3),
    /** 侦察与实际推进共用的未来节点预排队列 */
    nodeQueue: [],

    /** 当前节点上下文 */
    node: null,

    /** 撤离读条 */
    extract: null,

    /** 本轮携带物资 */
    carry: { hafCoin: 0, items: [] },

    counters: { kills: 0, bossKills: 0, crates: 0, damageTaken: 0, damageDealt: 0 },

    logs: [],
    fx: [],

    /** 干员自动技能运行时：绝对时间戳 CD + 临时状态 */
    skillRuntime: { cooldowns: {}, status: {}, casts: 0 },

    settled: false
  };
}

/* ============ 状态容器与订阅 ============ */

let state = createInitialState();
const listeners = new Set();
let notifyScheduled = false;
let silentDepth = 0;

export function getState() {
  return state;
}

export function setState(next) {
  if (!next || typeof next !== 'object') return;
  state = next;
  notify();
}

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 合帧通知，避免一次 tick 内重复渲染 */
export function notify() {
  if (silentDepth > 0) return;
  if (notifyScheduled) return;
  notifyScheduled = true;
  const run = () => {
    notifyScheduled = false;
    listeners.forEach((fn) => {
      try { fn(state); } catch (err) { console.error('[state] listener error', err); }
    });
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 16);
}

/** 批量修改：期间不通知，结束后统一通知一次 */
export function batch(fn) {
  silentDepth += 1;
  try { fn(state); } finally {
    silentDepth -= 1;
    notify();
  }
}

/* ============ 状态机 ============ */

export function canTransition(from, to) {
  const allow = TRANSITIONS[from];
  return Array.isArray(allow) && allow.includes(to);
}

/**
 * 迁移行动阶段
 * @returns {boolean} 是否迁移成功
 */
export function setPhase(to, { duration = 0, at = Date.now() } = {}) {
  const run = state.run;
  if (!run) return false;
  if (run.phase === to && to !== PHASE.MARCH) return false;
  if (!canTransition(run.phase, to)) {
    console.warn(`[state] 非法状态迁移 ${run.phase} → ${to}`);
    return false;
  }
  run.phase = to;
  run.phaseStartedAt = num(at, Date.now());
  run.phaseDuration = nonNeg(duration, 0);
  notify();
  return true;
}

/* ============ 校验与安全写入 ============ */

/** 货币变更，自动夹取非负 */
export function addCurrency(kind, amount) {
  if (kind !== 'hafCoin' && kind !== 'deltaCoin') return false;
  const cur = nonNeg(state.currency[kind], 0);
  const next = cur + num(amount, 0);
  if (next < 0) return false;
  state.currency[kind] = next;
  notify();
  return true;
}

export function canAfford(kind, amount) {
  if (kind !== 'hafCoin' && kind !== 'deltaCoin') return false;
  return nonNeg(state.currency[kind], 0) >= nonNeg(amount, 0);
}

export function spend(kind, amount) {
  const cost = nonNeg(amount, 0);
  if (!canAfford(kind, cost)) return false;
  state.currency[kind] = nonNeg(state.currency[kind], 0) - cost;
  notify();
  return true;
}

/** 追加战报，带时间戳并限制条数 */
export function pushLog(type, text) {
  const run = state.run;
  if (!run) return;
  run.logs.unshift({ id: uid('log'), at: Date.now(), type: String(type || 'info'), text: String(text ?? '') });
  if (run.logs.length > LOG_LIMIT) run.logs.length = LOG_LIMIT;
}

/** 保险箱容量（基础 + 技能扩容） */
export function safeboxCapacity(bonusSlots = 0) {
  return nonNegInt(SAFEBOX_BASE_SLOTS + nonNegInt(bonusSlots, 0), SAFEBOX_BASE_SLOTS);
}

/** 校验并修复状态树，读档后调用 */
export function sanitizeState(s) {
  const base = createInitialState();
  if (!s || typeof s !== 'object') return base;

  const out = base;

  out.version = nonNegInt(s.version, 2) || 2;
  out.createdAt = num(s.createdAt, Date.now());
  out.savedAt = num(s.savedAt, Date.now());

  out.currency.hafCoin = nonNeg(s?.currency?.hafCoin, INITIAL.hafCoin);
  out.currency.deltaCoin = nonNeg(s?.currency?.deltaCoin, INITIAL.deltaCoin);

  out.inventory = Array.isArray(s.inventory)
    ? s.inventory.filter((it) => it && getTemplate(it.tplId)).map((it) => ({
        uid: String(it.uid || uid('eq')),
        tplId: it.tplId,
        slot: getTemplate(it.tplId).slot
      }))
    : [];

  out.materials = {};
  if (s.materials && typeof s.materials === 'object') {
    Object.entries(s.materials).forEach(([k, v]) => {
      const n = nonNegInt(v, 0);
      if (n > 0) out.materials[k] = n;
    });
  }

  // 弹药储备：按发计数
  out.ammo = {};
  if (s.ammo && typeof s.ammo === 'object') {
    Object.entries(s.ammo).forEach(([k, v]) => {
      const n = nonNegInt(v, 0);
      if (n > 0 && getAmmo(k)) out.ammo[k] = n;
    });
  }
  // 旧版存档兼容：弹药曾是装备实例，按其原携带发数折算为发数储备
  const LEGACY_AMMO_ROUNDS = {
    am_t1: 260, am_t2: 240, am_t3: 220, am_t4: 200, am_t5: 180, am_t6: 160
  };
  if (Array.isArray(s.inventory)) {
    s.inventory.forEach((it) => {
      if (!it || !getAmmo(it.tplId)) return;
      const add = LEGACY_AMMO_ROUNDS[it.tplId] || 0;
      if (add > 0) out.ammo[it.tplId] = nonNegInt(out.ammo[it.tplId], 0) + add;
    });
  }

  // 选定弹种：必须是仍存在的弹种，携带发数夹取到库存与上限之间
  const wantAmmoId = typeof s?.ammoLoadout?.ammoId === 'string' ? s.ammoLoadout.ammoId : null;
  const validAmmoId = wantAmmoId && getAmmo(wantAmmoId) ? wantAmmoId : null;
  const fallbackAmmoId = Object.keys(out.ammo)[0] || 'am_t2';
  const pickedAmmoId = validAmmoId || fallbackAmmoId;
  out.ammoLoadout = {
    ammoId: pickedAmmoId,
    rounds: Math.min(
      AMMO_CARRY_MAX,
      Math.min(nonNegInt(out.ammo[pickedAmmoId], 0), nonNegInt(s?.ammoLoadout?.rounds, 0))
    )
  };

  const invIds = new Set(out.inventory.map((i) => i.uid));

  out.collectibles = {};
  if (s.collectibles && typeof s.collectibles === 'object') {
    Object.entries(s.collectibles).forEach(([k, v]) => {
      const n = nonNegInt(v, 0);
      if (n > 0 && getCollectible(k)) out.collectibles[k] = n;
    });
  }

  out.gallery = {};
  if (s.gallery && typeof s.gallery === 'object') {
    Object.entries(s.gallery).forEach(([k, v]) => {
      if (!v || typeof v !== 'object') return;
      out.gallery[k] = {
        at: num(v.at, Date.now()),
        count: Math.max(1, nonNegInt(v.count, 1))
      };
    });
  }

  // 干员 ID 必须在当前配置中存在，且未放出的干员不得残留在解锁与编成里
  const validOp = (id) => {
    const cfg = getOperator(id);
    return !!cfg && !cfg.comingSoon;
  };

  out.operators.unlocked = Array.isArray(s?.operators?.unlocked)
    ? s.operators.unlocked.filter((x) => typeof x === 'string' && validOp(x))
    : [];
  out.operators.levels = {};
  if (s?.operators?.levels && typeof s.operators.levels === 'object') {
    Object.entries(s.operators.levels).forEach(([k, v]) => {
      if (!validOp(k)) return;
      out.operators.levels[k] = Math.max(1, nonNegInt(v, 1));
    });
  }
  out.operators.squad = Array.isArray(s?.operators?.squad)
    ? [...new Set(s.operators.squad.filter((x) => typeof x === 'string' && validOp(x)))].slice(0, 3)
    : [];

  // 每名干员各自的装备槽；同一件装备只允许被一名干员占用
  out.loadouts = {};
  const claimed = new Set();
  const assign = (opId, source) => {
    if (!validOp(opId)) return;
    const slots = emptySlots();
    SLOT_IDS.forEach((slot) => {
      const val = source?.[slot];
      if (val && invIds.has(val) && !claimed.has(val)) {
        slots[slot] = val;
        claimed.add(val);
      }
    });
    out.loadouts[opId] = slots;
  };

  if (s?.loadouts && typeof s.loadouts === 'object') {
    Object.entries(s.loadouts).forEach(([opId, slots]) => {
      if (slots && typeof slots === 'object') assign(opId, slots);
    });
  } else if (s?.loadout && typeof s.loadout === 'object') {
    // 旧版存档：单一共享配装迁移给首位上阵干员（无人上阵则给首位已解锁干员）
    const heir = out.operators.squad[0] || out.operators.unlocked[0] || null;
    if (heir) assign(heir, s.loadout);
  }

  out.skills = {};
  if (s?.skills && typeof s.skills === 'object') {
    Object.entries(s.skills).forEach(([k, v]) => {
      const n = nonNegInt(v, 0);
      if (n > 0) out.skills[k] = n;
    });
  }

  out.safebox.items = Array.isArray(s?.safebox?.items)
    ? s.safebox.items.filter((it) => it && typeof it === 'object')
    : [];

  out.selection.mapId = typeof s?.selection?.mapId === 'string' ? s.selection.mapId : null;
  out.selection.difficulty = typeof s?.selection?.difficulty === 'string' ? s.selection.difficulty : null;

  out.activeTab = typeof s.activeTab === 'string' ? s.activeTab : 'map';

  if (s.run && typeof s.run === 'object' && !s.run.settled) {
    out.run = sanitizeRun(s.run);
    out.view = out.run ? VIEW.EXPLORE : VIEW.PREPARE;
  } else {
    out.run = null;
    out.view = VIEW.PREPARE;
  }

  if (s.stats && typeof s.stats === 'object') {
    Object.keys(out.stats).forEach((k) => { out.stats[k] = nonNegInt(s.stats[k], 0); });
  }

  return out;
}

function sanitizeRun(r) {
  const startedAt = num(r.startedAt, 0);
  const timeLimit = nonNeg(r.timeLimit, 0);
  if (!startedAt || !timeLimit) return null;
  if (typeof r.mapId !== 'string' || typeof r.difficulty !== 'string') return null;

  const maxHp = Math.max(1, nonNeg(r.maxHp, 1));
  const phase = Object.values(PHASE).includes(r.phase) ? r.phase : PHASE.MARCH;

  return {
    id: String(r.id || uid('run')),
    mapId: r.mapId,
    difficulty: r.difficulty,
    startedAt,
    timeLimit,
    endsAt: num(r.endsAt, startedAt + timeLimit * 1000),
    phase: phase === PHASE.SETTLE || phase === PHASE.PREPARE ? PHASE.MARCH : phase,
    phaseStartedAt: num(r.phaseStartedAt, startedAt),
    phaseDuration: nonNeg(r.phaseDuration, 3),
    squadSnapshot: Array.isArray(r.squadSnapshot) ? r.squadSnapshot : [],
    loadoutSnapshot: r.loadoutSnapshot && typeof r.loadoutSnapshot === 'object' ? r.loadoutSnapshot : {},
    maxHp,
    hp: Math.min(maxHp, Math.max(0, nonNeg(r.hp, maxHp))),
    members: (() => {
      const raw = Array.isArray(r.members) ? r.members.filter((m) => m && typeof m === 'object') : [];
      if (!raw.length) return makeRunMembers(r.squadSnapshot, maxHp, Math.min(maxHp, Math.max(0, nonNeg(r.hp, maxHp))));
      return raw.map((m, i) => {
        const memberMax = Math.max(1, nonNeg(m.maxHp, 1));
        const memberHp = Math.min(memberMax, Math.max(0, nonNeg(m.hp, 0)));
        return {
          id: String(m.id || r.squadSnapshot?.[i]?.id || `member_${i}`),
          name: String(m.name || r.squadSnapshot?.[i]?.name || m.id || `干员 ${i + 1}`),
          role: String(m.role || r.squadSnapshot?.[i]?.role || 'assault'),
          maxHp: memberMax,
          hp: memberHp,
          downed: !!m.downed || memberHp <= 0,
          downedAt: nonNeg(m.downedAt, 0),
          revived: nonNegInt(m.revived, 0)
        };
      });
    })(),
    ammo: {
      rounds: nonNegInt(r?.ammo?.rounds, 0),
      maxRounds: nonNegInt(r?.ammo?.maxRounds, 0),
      level: Math.min(6, nonNegInt(r?.ammo?.level, 0)),
      ammoId: typeof r?.ammo?.ammoId === 'string' ? r.ammo.ammoId : null,
      name: typeof r?.ammo?.name === 'string' ? r.ammo.name : '无弹药',
      spent: nonNegInt(r?.ammo?.spent, 0)
    },
    armorLevel: Math.min(6, Math.max(1, nonNegInt(r.armorLevel, 1))),
    distance: nonNeg(r.distance, 0),
    nodeIndex: nonNegInt(r.nodeIndex, 0),
    nodeGap: Math.max(0.5, nonNeg(r.nodeGap, 3)),
    nodeQueue: Array.isArray(r.nodeQueue) ? r.nodeQueue.filter((x) => ['crate', 'enemy', 'boss'].includes(x)).slice(0, 20) : [],
    node: r.node && typeof r.node === 'object' ? r.node : null,
    extract: r.extract && typeof r.extract === 'object' ? r.extract : null,
    carry: {
      hafCoin: nonNeg(r?.carry?.hafCoin, 0),
      items: Array.isArray(r?.carry?.items) ? r.carry.items.filter((x) => x && typeof x === 'object') : []
    },
    counters: {
      kills: nonNegInt(r?.counters?.kills, 0),
      bossKills: nonNegInt(r?.counters?.bossKills, 0),
      crates: nonNegInt(r?.counters?.crates, 0),
      damageTaken: nonNeg(r?.counters?.damageTaken, 0),
      damageDealt: nonNeg(r?.counters?.damageDealt, 0)
    },
    logs: Array.isArray(r.logs) ? r.logs.slice(0, LOG_LIMIT) : [],
    fx: [],
    skillRuntime: {
      cooldowns: r?.skillRuntime?.cooldowns && typeof r.skillRuntime.cooldowns === 'object'
        ? { ...r.skillRuntime.cooldowns }
        : {},
      status: r?.skillRuntime?.status && typeof r.skillRuntime.status === 'object'
        ? { ...r.skillRuntime.status }
        : {},
      casts: nonNegInt(r?.skillRuntime?.casts, 0)
    },
    settled: false
  };
}
