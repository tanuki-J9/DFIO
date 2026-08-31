/**
 * 行动时限与撤离系统
 * 时限在所有状态下持续流逝且不因节点事件暂停（需求 3.3）
 * 结算严格单次执行，时限归零与读条完成同帧时以「读条完成」优先（边界情况 6）
 */

import { EXTRACTION, getBranch } from '../config/index.js';
import {
  getState, notify, pushLog, setPhase, PHASE, FAIL_REASON
} from '../core/state.js';
import { remainingSeconds } from '../core/storage.js';
import { nonNeg, clamp, gate } from '../core/utils.js';
import { squadCombatStats } from './operator.js';
import { pushFx, resumeMarch } from './march.js';

let settleHandler = null;
/** 注册结算回调（由 settlement 模块提供） */
export function onSettle(fn) { settleHandler = fn; }

/** 计算本轮撤离读条时长（受撤离效率缩减） */
export function extractDuration(s = getState()) {
  const stats = squadCombatStats(s);
  const cut = clamp(stats.extractSpeed, 0, 0.75);
  return Math.max(EXTRACTION.minDuration, EXTRACTION.baseDuration * (1 - cut));
}

/** 本轮行动时限（受后勤续航延长） */
export function computeTimeLimit(mapId, difficulty, s = getState()) {
  const branch = getBranch(mapId, difficulty);
  if (!branch) return 0;
  const stats = squadCombatStats(s);
  const bonus = clamp(stats.timeLimitBonus, 0, 2);
  return Math.round(nonNeg(branch.timeLimit, 60) * (1 + bonus));
}

/** 剩余时限（秒） */
export function remaining(s = getState(), now = Date.now()) {
  return remainingSeconds(s.run, now);
}

/** 紧急预警阈值（秒） */
export function warnThreshold(run) {
  if (!run) return 0;
  return Math.min(EXTRACTION.warnThresholdMax, nonNeg(run.timeLimit, 0) * EXTRACTION.warnThresholdRatio);
}

/** 是否处于紧急预警（需求 3.8） */
export function isWarning(s = getState(), now = Date.now()) {
  const run = s.run;
  if (!run) return false;
  return remaining(s, now) <= warnThreshold(run);
}

/**
 * 剩余时间是否不足以完成撤离读条（需求 3.7）
 * 用于点击撤离时的二次确认警告
 */
export function isRisky(s = getState(), now = Date.now()) {
  return remaining(s, now) < extractDuration(s);
}

/** 撤离读条进度 0~1 */
export function extractProgress(s = getState(), now = Date.now()) {
  const run = s.run;
  if (!run || !run.extract) return 0;
  const dur = nonNeg(run.extract.duration, 1);
  if (dur <= 0) return 1;
  return clamp((now - nonNeg(run.extract.startedAt, now)) / (dur * 1000), 0, 1);
}

/**
 * 开始撤离
 * @param {boolean} confirmedRisk 已确认超时风险
 */
export function startExtraction({ confirmedRisk = false } = {}) {
  const s = getState();
  const run = s.run;
  if (!run || run.settled) return { ok: false, msg: '当前没有进行中的行动' };
  if (run.phase === PHASE.EXTRACTING) return { ok: false, msg: '已在撤离中' };
  if (!gate('extract-toggle', EXTRACTION.debounceMs)) return { ok: false, msg: '操作过于频繁' };

  const now = Date.now();
  const duration = extractDuration(s);

  if (remaining(s, now) < duration && !confirmedRisk) {
    return {
      ok: false,
      needConfirm: true,
      msg: `剩余时间不足以完成 ${duration.toFixed(1)} 秒撤离读条，该次撤离极可能超时失败`
    };
  }

  run.extract = { startedAt: now, duration, interrupted: false };
  if (!setPhase(PHASE.EXTRACTING, { duration, at: now })) {
    run.extract = null;
    return { ok: false, msg: '当前状态无法撤离' };
  }
  pushLog('extract', `呼叫撤离，读条 ${duration.toFixed(1)} 秒，期间可能被敌人打断`);
  pushFx('extract-start', {});
  return { ok: true, msg: '撤离程序已启动' };
}

/** 取消撤离，返回推进状态（需求 3.9） */
export function cancelExtraction() {
  const s = getState();
  const run = s.run;
  if (!run || run.phase !== PHASE.EXTRACTING) return { ok: false, msg: '当前不在撤离中' };
  if (!gate('extract-toggle', EXTRACTION.debounceMs)) return { ok: false, msg: '操作过于频繁' };

  const now = Date.now();
  run.extract = null;
  resumeMarch(s, now);
  pushLog('extract', '已取消撤离，小队继续推进');
  return { ok: true, msg: '撤离已取消' };
}

/** 撤离被打断（交战打断读条） */
function interruptExtraction(s, now) {
  const run = s.run;
  run.extract = null;
  resumeMarch(s, now);
  pushLog('fail', '撤离读条被敌人打断，需重新呼叫撤离！');
  pushFx('extract-break', {});
}

let settling = false;

/** 单次结算保护 */
function doSettle(success, reason) {
  const s = getState();
  const run = s.run;
  if (!run || run.settled || settling) return;
  settling = true;
  run.settled = true;
  try {
    if (typeof settleHandler === 'function') settleHandler({ success, reason });
  } finally {
    settling = false;
  }
}

/**
 * 主循环前置钩子
 * 判定顺序：读条完成 → 时限归零，保证同帧时撤离成功优先且只结算一次
 * @returns {boolean} 是否已进入结算（true 时主循环停止本轮推进）
 */
export function tickExtraction(s, now) {
  const run = s.run;
  if (!run || run.settled) return false;

  // 读档时发现时限早已耗尽：直接判超时失败（边界情况 10）
  if (run.expiredOnLoad) {
    run.expiredOnLoad = false;
    pushLog('fail', '恢复行动时发现行动时限已耗尽，判定撤离超时');
    doSettle(false, FAIL_REASON.TIMEOUT);
    return true;
  }

  // 优先级 1：撤离读条完成
  if (run.phase === PHASE.EXTRACTING && run.extract) {
    const done = extractProgress(s, now) >= 1;
    if (done) {
      pushLog('success', '撤离读条完成，小队成功脱离战区');
      pushFx('extract-done', {});
      doSettle(true, null);
      return true;
    }
    // 撤离中不触发新节点，但存在被打断的可能
    const elapsed = (now - nonNeg(run.extract.startedAt, now)) / 1000;
    if (elapsed > EXTRACTION.interruptWindow && Math.random() < interruptChance(run)) {
      interruptExtraction(s, now);
      return false;
    }
  }

  // 优先级 2：行动时限归零 → 撤离超时失败
  if (remaining(s, now) <= 0) {
    pushLog('fail', '行动时限耗尽，撤离超时！');
    doSettle(false, FAIL_REASON.TIMEOUT);
    return true;
  }

  notify();
  return false;
}

/** 打断概率随难度提升，按 tick 折算为极小概率 */
function interruptChance(run) {
  const map = { normal: 0.0008, secret: 0.0016, topSecret: 0.0026, eternal: 0.004 };
  return map[run.difficulty] ?? 0.0016;
}

/** 由 march 模块在小队被击溃时调用 */
export function settleByWipe() {
  doSettle(false, FAIL_REASON.WIPED);
}
