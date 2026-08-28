/**
 * 视图路由
 * 「作战准备」与「探索」两视图互斥挂载，非活跃视图暂停渲染与动画（需求 4.9）
 */

import { getState, notify, VIEW } from '../core/state.js';

const views = {};
let current = null;

/**
 * 注册视图
 * @param {string} name
 * @param {{ el: HTMLElement, mount: Function, render: Function, unmount: Function }} handler
 */
export function registerView(name, handler) {
  views[name] = handler;
}

export function currentView() {
  return current;
}

/** 切换视图：仅一个处于挂载可见状态 */
export function switchTo(name) {
  if (!views[name]) return false;
  if (current === name) return true;

  if (current && views[current]) {
    const prev = views[current];
    prev.el.classList.add('hidden');
    if (typeof prev.unmount === 'function') prev.unmount();
  }

  current = name;
  const next = views[name];
  next.el.classList.remove('hidden');
  // 重放入场动画
  next.el.classList.remove('view');
  void next.el.offsetWidth;
  next.el.classList.add('view');

  if (typeof next.mount === 'function') next.mount();
  if (typeof next.render === 'function') next.render();
  return true;
}

/** 仅渲染当前活跃视图 */
export function renderCurrent() {
  if (!current) return;
  const v = views[current];
  if (v && typeof v.render === 'function') v.render();
}

/** 依据状态同步视图（结算完成后自动返回作战准备，需求 4.8） */
export function syncViewFromState() {
  const s = getState();
  const target = s.run ? VIEW.EXPLORE : VIEW.PREPARE;
  if (s.view !== target) {
    s.view = target;
    notify();
  }
  if (current !== target) switchTo(target);
}
