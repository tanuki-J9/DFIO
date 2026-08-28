/**
 * 探索视图容器
 * 以像素演出区为主视觉，同屏展示时限、携带物资、战况、战报与撤离入口
 */

import { getState, PHASE, VIEW } from '../../core/state.js';
import { delegate, toast, confirmDialog } from '../components.js';
import { panelSkeleton, renderHeader, renderStats, renderCarry, renderLog } from './panel.js';
import { stageMarkup, bindStage, renderStage, pauseStage, resumeStage } from './stage.js';
import { startExtraction, cancelExtraction, extractDuration, remaining } from '../../systems/extraction.js';
import { fmtTime } from '../../core/utils.js';

let el = null;
let structured = false;
let lastKeys = { header: '', stats: '', carry: '', log: '' };

export function getExploreEl() {
  el = el || document.getElementById('view-explore');
  return el;
}

export function mountExplore() {
  const root = getExploreEl();
  if (!root) return;
  structured = false;
  if (root.dataset.bound !== '1') {
    root.dataset.bound = '1';
    bind(root);
  }
  resumeStage();
}

export function unmountExplore() {
  pauseStage();
  structured = false;
  lastKeys = { header: '', stats: '', carry: '', log: '' };
}

export function renderExplore() {
  const root = getExploreEl();
  if (!root || root.classList.contains('hidden')) return;
  const s = getState();
  const run = s.run;
  if (!run) return;

  const now = Date.now();

  if (!structured) {
    root.innerHTML = panelSkeleton();
    const wrap = root.querySelector('#ex-stage-wrap');
    if (wrap) wrap.innerHTML = stageMarkup(s);
    bindStage();
    structured = true;
    lastKeys = { header: '', stats: '', carry: '', log: '' };
  }

  // 顶部每帧更新（倒计时与读条）
  setSection(root, '#ex-header', renderHeader(s, now), 'header', keyHeader(s, now));
  setSection(root, '#ex-stats', renderStats(s), 'stats', keyStats(run));
  setSection(root, '#ex-carry', renderCarry(s), 'carry', keyCarry(run));
  setSection(root, '#ex-log', renderLog(s), 'log', keyLog(run));

  renderStage(s, now);
}

function setSection(root, selector, html, keyName, key) {
  if (lastKeys[keyName] === key) return;
  lastKeys[keyName] = key;
  const box = root.querySelector(selector);
  if (box) box.innerHTML = html;
}

/** 倒计时按秒变化即重绘，避免每 100ms 重建 DOM */
function keyHeader(s, now) {
  const run = s.run;
  const sec = Math.ceil(remaining(s, now));
  const ex = run.phase === PHASE.EXTRACTING ? Math.floor((now - run.extract?.startedAt) / 200) : -1;
  return `${sec}|${run.phase}|${run.hp}|${ex}`;
}

function keyStats(run) {
  const c = run.counters;
  return `${c.kills}|${c.bossKills}|${c.crates}|${c.damageDealt}|${c.damageTaken}|${run.nodeIndex}`;
}

function keyCarry(run) {
  return `${run.carry.items.length}|${run.carry.hafCoin}`;
}

function keyLog(run) {
  return `${run.logs.length}|${run.logs[0]?.id || ''}`;
}

/* ============ 交互 ============ */

function bind(root) {
  delegate(root, {
    'start-extract': async () => {
      const s = getState();
      const first = startExtraction();
      if (first.ok) {
        toast(first.msg, 'ok');
        return;
      }
      if (!first.needConfirm) {
        toast(first.msg, 'err');
        return;
      }
      const dur = extractDuration(s);
      const left = remaining(s);
      const ok = await confirmDialog({
        title: '撤离超时风险确认',
        body: `
          <p class="mb-2">撤离读条需要 <span class="text-rust">${dur.toFixed(1)} 秒</span>，
          当前剩余行动时限仅 <span class="text-rust">${fmtTime(left)}</span>。</p>
          <p class="mb-2">该次撤离<span class="text-rust">极可能超时失败</span>。一旦超时，
          将仅保留保险箱中的物品，本轮携带物资与所携装备全部损失。</p>
          <p>是否仍要强行呼叫撤离？</p>
        `,
        okText: '强行撤离',
        cancelText: '再等等',
        danger: true
      });
      if (!ok) return;
      const r = startExtraction({ confirmedRisk: true });
      toast(r.msg, r.ok ? 'warn' : 'err');
    },

    'cancel-extract': () => {
      const r = cancelExtraction();
      toast(r.msg, r.ok ? 'ok' : 'err');
    }
  });
}

export const EXPLORE_VIEW_NAME = VIEW.EXPLORE;
