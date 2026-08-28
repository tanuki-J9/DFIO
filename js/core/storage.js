/**
 * 存档层：序列化至 localStorage + 断点恢复
 * 行动时限以出发时的绝对时间戳为基准，刷新不重置（技术约束 4）
 */

import { getState, setState, sanitizeState, createInitialState, PHASE } from './state.js';
import { num } from './utils.js';

const KEY = 'delta_idle_save_v1';
const SAVE_VERSION = 1;

let saveTimer = null;
let available = true;

function probe() {
  try {
    const k = '__delta_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

available = probe();
if (!available) console.warn('[storage] localStorage 不可用，本次运行不会持久化');

/** 立即写盘 */
export function saveNow() {
  if (!available) return false;
  const s = getState();
  s.savedAt = Date.now();
  try {
    const payload = { version: SAVE_VERSION, savedAt: s.savedAt, data: s };
    localStorage.setItem(KEY, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.error('[storage] 存档写入失败', err);
    return false;
  }
}

/** 节流写盘，避免主循环高频写入 */
export function save(delay = 800) {
  if (!available) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, num(delay, 800));
}

/** 版本迁移：未来新增字段在此处补齐 */
function migrate(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const v = num(payload.version, 0);
  let data = payload.data;
  if (!data || typeof data !== 'object') return null;
  if (v < 1) data = { ...data, version: 1 };
  return data;
}

/**
 * 读档并写入状态容器
 * @returns {{ loaded: boolean, resumed: boolean, expired: boolean }}
 */
export function load() {
  if (!available) {
    setState(createInitialState());
    return { loaded: false, resumed: false, expired: false };
  }

  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (err) {
    console.error('[storage] 读取失败', err);
  }

  if (!raw) {
    setState(createInitialState());
    return { loaded: false, resumed: false, expired: false };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('[storage] 存档损坏，已重置', err);
    setState(createInitialState());
    return { loaded: false, resumed: false, expired: false };
  }

  const migrated = migrate(parsed);
  const clean = sanitizeState(migrated);

  const result = { loaded: true, resumed: false, expired: false };

  if (clean.run) {
    const now = Date.now();
    const remain = remainingSeconds(clean.run, now);
    if (remain <= 0) {
      // 长时间关闭页面后时限早已耗尽 → 标记为超时待结算，不继续推进
      clean.run.phase = PHASE.MARCH;
      clean.run.expiredOnLoad = true;
      result.expired = true;
    } else {
      // 阶段计时同样基于时间戳，若阶段已越界则由引擎在下一 tick 收尾
      result.resumed = true;
    }
  }

  setState(clean);
  return result;
}

/** 基于时间戳差值计算剩余时限（秒），恒不为负 */
export function remainingSeconds(run, now = Date.now()) {
  if (!run) return 0;
  const endsAt = num(run.endsAt, num(run.startedAt, 0) + num(run.timeLimit, 0) * 1000);
  return Math.max(0, (endsAt - num(now, Date.now())) / 1000);
}

/** 已消耗时间（秒） */
export function elapsedSeconds(run, now = Date.now()) {
  if (!run) return 0;
  return Math.max(0, (num(now, Date.now()) - num(run.startedAt, 0)) / 1000);
}

/** 当前阶段已进行时间（秒） */
export function phaseElapsed(run, now = Date.now()) {
  if (!run) return 0;
  return Math.max(0, (num(now, Date.now()) - num(run.phaseStartedAt, 0)) / 1000);
}

/** 当前阶段进度 0~1 */
export function phaseProgress(run, now = Date.now()) {
  if (!run || num(run.phaseDuration, 0) <= 0) return 1;
  return Math.min(1, phaseElapsed(run, now) / num(run.phaseDuration, 1));
}

export function clearSave() {
  if (!available) return;
  try { localStorage.removeItem(KEY); } catch (err) { console.error('[storage] 清档失败', err); }
}

export function hasSave() {
  if (!available) return false;
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

/** 页面隐藏或关闭时强制写盘，保证时间戳落地 */
export function bindAutoSave() {
  if (typeof window === 'undefined') return;
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  window.addEventListener('pagehide', saveNow);
  window.addEventListener('beforeunload', saveNow);
}
