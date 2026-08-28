/**
 * 主循环
 * 完全基于时间戳差值驱动，禁止依赖帧累加（技术约束 4）
 * 页面切后台或刷新后回到前台，进度与倒计时均正确
 */

import { TICK_MS } from '../config/index.js';
import { getState, PHASE } from './state.js';
import { save } from './storage.js';
import { num } from './utils.js';

let timerId = null;
let running = false;
const beforeHooks = [];
const afterHooks = [];
let advanceFn = null;
let saveAccum = 0;

/** 注册逻辑推进函数（march.advance） */
export function setAdvance(fn) {
  advanceFn = typeof fn === 'function' ? fn : null;
}

/** tick 前置钩子：用于时限与撤离判定（须先于推进执行） */
export function onBeforeTick(fn) {
  if (typeof fn === 'function') beforeHooks.push(fn);
}

/** tick 后置钩子 */
export function onAfterTick(fn) {
  if (typeof fn === 'function') afterHooks.push(fn);
}

function tick() {
  const now = Date.now();
  const s = getState();

  try {
    for (const hook of beforeHooks) {
      // 任一钩子返回 true 表示本轮已进入结算，停止后续推进
      if (hook(s, now) === true) return;
    }
  } catch (err) {
    console.error('[loop] before hook error', err);
  }

  const run = s.run;
  if (run && !run.settled && run.phase !== PHASE.SETTLE) {
    try {
      if (advanceFn) advanceFn(s, now);
    } catch (err) {
      console.error('[loop] advance error', err);
    }
  }

  try {
    afterHooks.forEach((hook) => hook(s, now));
  } catch (err) {
    console.error('[loop] after hook error', err);
  }

  saveAccum += TICK_MS;
  if (saveAccum >= 2000) {
    saveAccum = 0;
    save(0);
  }
}

export function startLoop() {
  if (running) return;
  running = true;
  timerId = setInterval(tick, num(TICK_MS, 100));
  tick();
}

export function stopLoop() {
  running = false;
  if (timerId) clearInterval(timerId);
  timerId = null;
}

export function isLoopRunning() {
  return running;
}

/** 回到前台后立即补算一次，缩短视觉延迟 */
export function bindVisibility() {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && running) tick();
  });
}
