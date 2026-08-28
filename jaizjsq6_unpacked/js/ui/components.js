/**
 * UI 通用组件：轻提示、确认弹窗、事件委托
 * 所有交互通过 JS 事件绑定，HTML 中不写 onclick 等属性
 */

import { esc } from '../core/utils.js';

const toastRoot = () => document.getElementById('toast-root');
const modalRoot = () => document.getElementById('modal-root');

/** 轻提示 */
export function toast(msg, type = 'info') {
  const root = toastRoot();
  if (!root || !msg) return;
  const color = {
    info: 'border-line text-sand',
    ok: 'border-delta/60 text-delta',
    warn: 'border-amber-400/60 text-amber-300',
    err: 'border-rust/60 text-rust'
  }[type] || 'border-line text-sand';

  const el = document.createElement('div');
  el.className = `toast-item clip-tab bg-panel/95 border ${color} px-4 py-2 text-xs max-w-xs shadow-lg`;
  el.textContent = String(msg);
  root.appendChild(el);

  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 260);
  }, 2400);
}

/**
 * 确认弹窗
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, body, okText = '确认', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const root = modalRoot();
    if (!root) { resolve(false); return; }

    const wrap = document.createElement('div');
    wrap.className = 'modal-mask fixed inset-0 z-[70] bg-black/75 flex items-center justify-center p-4';
    wrap.innerHTML = `
      <div class="modal-body clip-corner w-full max-w-md bg-panel border ${danger ? 'border-rust/60' : 'border-line'}">
        <div class="px-5 py-3 border-b ${danger ? 'border-rust/40' : 'border-line'} flex items-center gap-2">
          <span class="text-lg">${danger ? '⚠️' : '❓'}</span>
          <h3 class="text-sm ${danger ? 'text-rust' : 'text-delta'} tracking-wider">${esc(title || '确认操作')}</h3>
        </div>
        <div class="px-5 py-4 text-xs leading-relaxed text-sand/85">${body || ''}</div>
        <div class="px-5 py-3 border-t border-line flex justify-end gap-3">
          <button data-act="cancel" class="btn clip-tab px-4 py-2 text-xs border border-line bg-panel2 hover:bg-line">${esc(cancelText)}</button>
          <button data-act="ok" class="btn clip-tab px-4 py-2 text-xs border ${danger ? 'border-rust bg-rust/20 text-rust hover:bg-rust/30' : 'border-delta bg-delta/20 text-delta hover:bg-delta/30'}">${esc(okText)}</button>
        </div>
      </div>
    `;

    const close = (val) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };

    wrap.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') close(true);
      else if (act === 'cancel') close(false);
      else if (e.target === wrap) close(false);
    });
    document.addEventListener('keydown', onKey);

    root.appendChild(wrap);
  });
}

/** 信息弹窗 */
export function infoDialog({ title, body, okText = '知道了' }) {
  return confirmDialog({ title, body, okText, cancelText: '关闭' });
}

/**
 * 大型面板弹窗，返回控制句柄
 */
export function openPanel({ title, bodyHtml, onMount, wide = false }) {
  const root = modalRoot();
  if (!root) return { close: () => {} };

  const wrap = document.createElement('div');
  wrap.className = 'modal-mask fixed inset-0 z-[65] bg-black/75 flex items-center justify-center p-4';
  wrap.innerHTML = `
    <div class="modal-body clip-corner w-full ${wide ? 'max-w-5xl' : 'max-w-2xl'} max-h-[86vh] flex flex-col bg-panel border border-line">
      <div class="px-5 py-3 border-b border-line flex items-center justify-between shrink-0">
        <h3 class="text-sm text-delta tracking-wider">${esc(title || '')}</h3>
        <button data-act="close" class="btn text-sand/60 hover:text-rust text-lg leading-none px-2">✕</button>
      </div>
      <div data-role="body" class="px-5 py-4 overflow-y-auto grow">${bodyHtml || ''}</div>
    </div>
  `;

  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="close"]')) close();
    else if (e.target === wrap) close();
  });
  document.addEventListener('keydown', onKey);

  root.appendChild(wrap);
  if (typeof onMount === 'function') onMount(wrap.querySelector('[data-role="body"]'), close);
  return { close, body: wrap.querySelector('[data-role="body"]') };
}

/** 事件委托绑定：容器上按 data-action 分发 */
export function delegate(container, handlers) {
  if (!container || !handlers) return;
  container.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !container.contains(el)) return;
    const fn = handlers[el.dataset.action];
    if (typeof fn === 'function') {
      e.preventDefault();
      fn(el.dataset, el, e);
    }
  });
  container.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (!el || !container.contains(el)) return;
    const fn = handlers[el.dataset.change];
    if (typeof fn === 'function') fn(el.dataset, el, e);
  });
}

/** 通用面板外框 */
export function panelShell({ title, subtitle = '', right = '', body, cls = '' }) {
  return `
    <section class="clip-corner bg-panel border border-line ${cls}">
      <header class="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-sm text-delta tracking-wider truncate">${esc(title)}</h2>
          ${subtitle ? `<p class="text-[11px] text-sand/45 mt-0.5 truncate">${esc(subtitle)}</p>` : ''}
        </div>
        <div class="shrink-0 flex items-center gap-2">${right}</div>
      </header>
      <div class="p-4">${body}</div>
    </section>
  `;
}

/** 统计小卡 */
export function statCard({ label, value, sub = '', tone = 'sand' }) {
  const toneCls = {
    sand: 'text-sand',
    delta: 'text-delta',
    rust: 'text-rust',
    amber: 'text-amber-400',
    sky: 'text-sky-400'
  }[tone] || 'text-sand';
  return `
    <div class="clip-tab bg-panel2 border border-line px-3 py-2">
      <p class="text-[10px] text-sand/45 tracking-wider">${esc(label)}</p>
      <p class="text-lg ${toneCls} mt-0.5 leading-tight">${value}</p>
      ${sub ? `<p class="text-[10px] text-sand/40 mt-0.5">${sub}</p>` : ''}
    </div>
  `;
}

/** 进度条 */
export function progressBar({ ratio, color = 'bg-delta', height = 'h-2', label = '' }) {
  const w = Math.max(0, Math.min(100, ratio * 100));
  return `
    <div>
      ${label ? `<div class="flex justify-between text-[10px] text-sand/50 mb-1">${label}</div>` : ''}
      <div class="bar-track ${height} border border-line">
        <div class="bar-fill ${color} h-full" style="width:${w}%"></div>
      </div>
    </div>
  `;
}

/** 空态占位 */
export function emptyState(text, icon = '📭') {
  return `
    <div class="flex flex-col items-center justify-center py-10 text-sand/35">
      <span class="text-3xl mb-2">${icon}</span>
      <p class="text-xs">${esc(text)}</p>
    </div>
  `;
}
