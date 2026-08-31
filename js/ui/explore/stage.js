/**
 * 像素演出区
 * 演出层单向消费状态数据，绝不反向影响状态（技术约束 5）
 * 全部精灵与动画由 CSS 绘制，无外部图片（技术约束 2）
 */

import { MAPS, FX_LIMIT } from '../../config/index.js';
import { getState, PHASE } from '../../core/state.js';
import { esc, nonNeg } from '../../core/utils.js';
import { phaseProgress } from '../../core/storage.js';
import { drainFx } from '../../systems/march.js';
import { isWarning, extractProgress } from '../../systems/extraction.js';
import { nodeLabel } from '../../systems/march.js';
import { ensureSquadMembers } from '../../systems/operatorSkills.js';
import { itemArt } from '../itemArt.js';

let stageEl = null;
let lastNodeKey = '';
let lastSquadKey = '';

/** 演出区骨架 */
export function stageMarkup(s) {
  const run = s.run;
  const map = MAPS.find((m) => m.id === run?.mapId);
  return `
    <section class="clip-corner bg-panel border border-line overflow-hidden">
      <header class="px-4 py-2.5 border-b border-line flex items-center justify-between">
        <h3 class="text-xs text-delta tracking-wider">前线实况 · 像素演出</h3>
        <span id="stage-phase" class="text-[10px] text-sand/45"></span>
      </header>
      <div id="stage" class="stage" data-theme="${map?.theme || 'dam'}" data-moving="1">
        <div class="sky-grid"></div>
        <div class="stars"></div>
        <div class="layer-far"></div>
        <div class="layer-mid"></div>
        <div class="ground"></div>
        <div class="ground-dots"></div>
        <div class="ground-line"></div>
        <div id="stage-objects"></div>
        <div id="stage-actors" class="actors"></div>
        <div id="stage-fx" class="fx-layer"></div>
        <div id="stage-badge" class="stage-badge"></div>
        <p class="stage-hint">全部画面由 CSS 绘制</p>
      </div>
      <div id="stage-progress" class="px-4 py-2 border-t border-line"></div>
    </section>
  `;
}

export function bindStage() {
  stageEl = document.getElementById('stage');
  lastNodeKey = '';
  lastSquadKey = '';
}

/** 每帧渲染：只读状态 */
export function renderStage(s, now) {
  const run = s.run;
  stageEl = stageEl || document.getElementById('stage');
  if (!stageEl || !run) return;

  const moving = run.phase === PHASE.MARCH || run.phase === PHASE.EXTRACTING;
  stageEl.dataset.moving = moving ? '1' : '0';
  stageEl.classList.toggle('danger', isWarning(s, now));

  renderActors(s);
  renderObjects(s, now);
  renderFx();
  renderBadge(s, now);
  renderProgress(s, now);
}

/** 像素小人：按上阵干员数量渲染 */
function renderActors(s) {
  const run = s.run;
  const box = document.getElementById('stage-actors');
  if (!box) return;

  const act = actByPhase(run);
  const life = ensureSquadMembers(run);
  const lifeById = new Map(life.map((m) => [m.id, m]));
  const key = `${run.squadSnapshot.map((o) => `${o.id}:${lifeById.get(o.id)?.downed ? 'down' : 'up'}`).join(',')}|${act}`;
  const members = run.squadSnapshot.length
    ? run.squadSnapshot
    : [{ id: 'unknown', role: 'assault', name: '干员' }];

  if (key !== lastSquadKey) {
    lastSquadKey = key;
    box.innerHTML = members.map((op) => actorMarkup(op, lifeById.get(op.id), act)).join('');
  }

  members.forEach((op) => {
    const member = lifeById.get(op.id);
    const actor = box.querySelector(`[data-actor-id="${cssAttr(op.id)}"]`);
    if (!actor || !member) return;
    const ratio = member.maxHp > 0 ? member.hp / member.maxHp : 0;
    const fill = actor.querySelector('.squad-hp-fill');
    const nameplate = actor.querySelector('.squad-nameplate');
    const value = actor.querySelector('.squad-hp-value');
    const tone = healthTone(ratio, member.downed);
    if (fill) {
      fill.style.width = `${Math.max(0, Math.min(100, ratio * 100)).toFixed(1)}%`;
      fill.classList.toggle('is-warning', tone === 'warning');
      fill.classList.toggle('is-critical', tone === 'critical');
    }
    if (nameplate) {
      nameplate.classList.toggle('is-warning', tone === 'warning');
      nameplate.classList.toggle('is-critical', tone === 'critical');
    }
    if (value) value.textContent = member.downed ? '倒地' : `${Math.round(member.hp)}/${Math.round(member.maxHp)}`;
  });
}

function cssAttr(value) {
  return String(value ?? '').replace(/["\\]/g, '\\$&');
}

export function actorMarkup(op, member, act) {
  const ratio = member?.maxHp > 0 ? member.hp / member.maxHp : 0;
  const downed = Boolean(member?.downed);
  const memberAct = downed ? 'down' : act;
  const name = member?.name || op.name || '干员';
  const tone = healthTone(ratio, downed);
  const hpTone = tone === 'healthy' ? '' : ` is-${tone}`;
  return `
    <div class="squad-actor${downed ? ' is-downed' : ''}" data-actor-id="${esc(op.id)}">
      <div class="squad-nameplate${hpTone}">
        <div class="squad-name">${esc(name)}${downed ? ' · 倒地' : ''}</div>
        <div class="squad-hp"><div class="squad-hp-fill${hpTone}" style="width:${Math.max(0, Math.min(100, ratio * 100)).toFixed(1)}%"></div></div>
        <div class="squad-hp-value">${downed ? '倒地' : `${Math.round(member?.hp || 0)}/${Math.round(member?.maxHp || 0)}`}</div>
      </div>
    <div class="sprite" data-role="${esc(op.role)}" data-act="${memberAct}" title="${esc(op.name)}${member?.downed ? ' · 倒地' : ''}">
      <div class="helmet"></div>
      <div class="head"></div>
      <div class="body"></div>
      <div class="vest"></div>
      <div class="arm"></div>
      <div class="gun"></div>
      <div class="leg-l"></div>
      <div class="leg-r"></div>
    </div>
    </div>
  `;
}

export function healthTone(ratio, downed = false) {
  if (downed || ratio <= 0.25) return 'critical';
  if (ratio <= 0.5) return 'warning';
  return 'healthy';
}

export function medicalUsesText(run) {
  const maxUses = Math.floor(nonNeg(run?.medical?.maxUses, 0));
  if (maxUses <= 0) return '';
  const remainingUses = Math.min(maxUses, Math.floor(nonNeg(run?.medical?.remainingUses, 0)));
  return `急救包 ${remainingUses}/${maxUses}`;
}

export function medicalFxText(fx) {
  const amount = Math.round(nonNeg(fx?.amount, 0));
  const maxUses = Math.floor(nonNeg(fx?.maxUses, 0));
  const remainingUses = Math.min(maxUses, Math.floor(nonNeg(fx?.remainingUses, 0)));
  return `急救 +${amount} · 剩余 ${remainingUses}/${maxUses}`;
}

const LOOT_REVEAL_POINTS = { common: 0.34, rare: 0.48, epic: 0.62, legend: 0.76, red: 0.9 };

export function lootRevealAt(rarity) {
  return LOOT_REVEAL_POINTS[rarity] ?? LOOT_REVEAL_POINTS.common;
}

export function lootSearchMarkup(items = [], progress = 0) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  return `<div class="loot-search-grid">${items.map((item) => {
    const revealed = p >= lootRevealAt(item.rarity);
    return `<div class="loot-search-slot bd-${esc(item.rarity || 'common')}" data-loot-uid="${esc(item.uid)}" data-revealed="${revealed ? '1' : '0'}">
      ${revealed
        ? `${itemArt(item, { size: 'sm', showLevel: true })}<span class="loot-search-name rar-${esc(item.rarity || 'common')}">${esc(item.name)}${item.count > 1 ? ` ×${item.count}` : ''}</span>`
        : '<span class="loot-search-mask"><span class="loot-magnifier" aria-hidden="true"></span><span class="loot-searching">搜索中</span></span>'}
    </div>`;
  }).join('')}</div>`;
}

function actByPhase(run) {
  switch (run.phase) {
    case PHASE.SCAVENGE: return 'loot';
    case PHASE.COMBAT: return 'fight';
    case PHASE.EXTRACTING: return 'extract';
    default: return 'walk';
  }
}

/** 场景对象：补给箱 / 敌人 / 直升机 */
function renderObjects(s, now) {
  const run = s.run;
  const box = document.getElementById('stage-objects');
  if (!box) return;

  const node = run.node;
  const key = `${run.phase}|${node?.kind || 'none'}|${node?.name || node?.enemy?.name || ''}|${run.nodeIndex}`;

  if (key !== lastNodeKey) {
    lastNodeKey = key;
    box.innerHTML = buildObjects(run);
  }

  // 血条与开箱进度按帧更新，不重建 DOM
  if (run.phase === PHASE.COMBAT && node?.enemy) {
    const fill = box.querySelector('.enemy-hp .fill');
    if (fill) {
      const ratio = nonNeg(node.enemy.maxHp, 1) > 0 ? node.enemy.hp / node.enemy.maxHp : 0;
      fill.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
    }
  }

  if (run.phase === PHASE.SCAVENGE) {
    const crate = box.querySelector('.crate');
    if (crate) {
      const p = phaseProgress(run, now);
      crate.classList.toggle('opened', p >= 0.85);
      crate.classList.toggle('opening', p < 0.85);
    }
    const items = Array.isArray(node?.pendingLoot) ? node.pendingLoot : [];
    const grid = box.querySelector('.loot-search-grid');
    if (grid && items.length) {
      const p = phaseProgress(run, now);
      Array.from(grid.children).forEach((slot, index) => {
        const item = items[index];
        if (!item || slot.dataset.revealed === '1' || p < lootRevealAt(item.rarity)) return;
        slot.dataset.revealed = '1';
        slot.innerHTML = `${itemArt(item, { size: 'sm', showLevel: true })}<span class="loot-search-name rar-${esc(item.rarity || 'common')}">${esc(item.name)}${item.count > 1 ? ` ×${item.count}` : ''}</span>`;
      });
    }
  }
}

function buildObjects(run) {
  const node = run.node;

  if (run.phase === PHASE.EXTRACTING) {
    return `
      <div class="chopper">
        <div class="rotor"></div>
        <div class="cabin"></div>
        <div class="tail"></div>
      </div>
    `;
  }

  if (run.phase === PHASE.SCAVENGE && node?.kind === 'crate') {
    return `
      <div class="crate opening" data-rarity="${esc(node.rarity || 'common')}">
        <div class="lid"></div>
      </div>
      ${lootSearchMarkup(node.pendingLoot || [], 0)}
    `;
  }

  if (run.phase === PHASE.COMBAT && node?.enemy) {
    const e = node.enemy;
    const ratio = nonNeg(e.maxHp, 1) > 0 ? e.hp / e.maxHp : 0;
    return `
      <div class="enemy ${e.isBoss ? 'is-boss' : ''}" data-act="fight">
        <div class="head"></div>
        <div class="body"></div>
        <div class="gun"></div>
        <div class="leg-l"></div>
        <div class="leg-r"></div>
      </div>
      <div class="enemy-hp">
        <p class="name">${esc(e.name)}${e.isBoss ? ' · BOSS' : ''}</p>
        <div class="bar"><div class="fill" style="width:${Math.max(0, ratio * 100)}%"></div></div>
      </div>
    `;
  }

  return '';
}

/** 特效层：消费队列并做同屏数量上限保护 */
function renderFx() {
  const layer = document.getElementById('stage-fx');
  if (!layer) return;

  const list = drainFx();
  if (!list.length) return;

  // 超出上限时清理最早的元素
  while (layer.children.length > FX_LIMIT) layer.removeChild(layer.firstChild);

  list.forEach((fx) => {
    const el = buildFxElement(fx);
    if (!el) return;
    layer.appendChild(el);
    // 动画结束后清理 DOM，避免节点堆积
    const life = el.dataset.life ? Number(el.dataset.life) : 950;
    setTimeout(() => el.remove(), life);
  });

  while (layer.children.length > FX_LIMIT) layer.removeChild(layer.firstChild);
}

function buildFxElement(fx) {
  const el = document.createElement('div');
  const rx = () => `${45 + Math.random() * 35}%`;
  const ry = () => `${30 + Math.random() * 25}%`;

  switch (fx.type) {
    case 'hit-enemy':
      el.className = `fx ${fx.boss ? 'fx-crit' : 'fx-dmg-out'}`;
      el.textContent = fx.gun === false ? `-${fx.amount} 技能` : `-${fx.amount}`;
      el.style.right = rx();
      el.style.bottom = ry();
      break;
    case 'miss':
      el.className = 'fx fx-loot';
      el.textContent = 'MISS';
      el.style.right = rx();
      el.style.bottom = ry();
      break;
    case 'ammo-empty':
      el.className = 'fx fx-crit';
      el.textContent = '弹药耗尽 · 枪械停火';
      el.style.right = '28%';
      el.style.bottom = '52%';
      el.dataset.life = '1400';
      shakeStage();
      break;
    case 'hit-squad':
      el.className = 'fx fx-dmg-in';
      el.textContent = `-${fx.amount}`;
      el.style.left = '10%';
      el.style.bottom = ry();
      shakeStage();
      break;
    case 'heal':
      el.className = 'fx fx-heal';
      el.textContent = fx.revive ? (fx.amount ? `复活 +${fx.amount}` : '救助读条') : `+${fx.amount}`;
      el.style.left = '12%';
      el.style.bottom = '46%';
      break;
    case 'medical-heal':
      el.className = 'fx fx-medical';
      el.textContent = medicalFxText(fx);
      el.style.left = '12%';
      el.style.bottom = '46%';
      break;
    case 'heal-enemy':
      el.className = 'fx fx-heal';
      el.textContent = `敌方 +${fx.amount}${fx.reduced ? '（减疗）' : ''}`;
      el.style.right = '20%';
      el.style.bottom = '46%';
      break;
    case 'smoke':
      el.className = 'fx fx-loot';
      el.textContent = `烟雾掩护 ${fx.seconds || 0}s`;
      el.style.left = '18%';
      el.style.bottom = '54%';
      break;
    case 'dash':
      el.className = 'fx fx-loot';
      el.textContent = `突进 +${Math.round(fx.amount || 0)}m`;
      el.style.left = '22%';
      el.style.bottom = '58%';
      break;
    case 'recon':
      el.className = 'fx fx-loot';
      el.textContent = fx.enemies != null ? `侦察：敌情 ${fx.enemies}` : '侦察完成';
      el.style.right = '28%';
      el.style.bottom = '60%';
      break;
    case 'loot-pop':
      el.className = 'fx fx-loot';
      el.textContent = String(fx.text || '+战利品');
      el.style.right = rx();
      el.style.bottom = ry();
      break;
    case 'boss-enter':
      el.className = 'fx fx-crit';
      el.textContent = `⚠ ${fx.name || 'BOSS'} 出现`;
      el.style.right = '30%';
      el.style.bottom = '58%';
      el.dataset.life = '1200';
      shakeStage();
      break;
    case 'enemy-enter':
      el.className = 'fx fx-dmg-in';
      el.textContent = `${fx.name || '敌人'}`;
      el.style.right = '24%';
      el.style.bottom = '52%';
      break;
    case 'crate-open':
      el.className = 'fx fx-loot';
      el.textContent = '搜刮中…';
      el.style.right = '26%';
      el.style.bottom = '48%';
      break;
    case 'enemy-die':
      el.className = 'fx fx-crit';
      el.textContent = fx.boss ? 'BOSS 已消灭' : '目标已消灭';
      el.style.right = '24%';
      el.style.bottom = '52%';
      break;
    case 'extract-start':
      el.className = 'fx fx-loot';
      el.textContent = '🚁 撤离载具接近';
      el.style.right = '20%';
      el.style.bottom = '62%';
      el.dataset.life = '1200';
      break;
    case 'extract-break':
      el.className = 'fx fx-dmg-in';
      el.textContent = '撤离被打断！';
      el.style.right = '26%';
      el.style.bottom = '58%';
      shakeStage();
      break;
    case 'extract-done':
      el.className = 'fx fx-loot';
      el.textContent = '✅ 撤离成功';
      el.style.right = '30%';
      el.style.bottom = '60%';
      break;
    case 'wipe':
      el.className = 'fx fx-dmg-in';
      el.textContent = '☠ 小队被击溃';
      el.style.left = '20%';
      el.style.bottom = '58%';
      shakeStage();
      break;
    default:
      return null;
  }
  return el;
}

let shakeTimer = null;
function shakeStage() {
  if (!stageEl) return;
  stageEl.classList.add('shake');
  if (shakeTimer) clearTimeout(shakeTimer);
  shakeTimer = setTimeout(() => stageEl && stageEl.classList.remove('shake'), 240);
}

/** 状态角标 */
function renderBadge(s, now) {
  const run = s.run;
  const badge = document.getElementById('stage-badge');
  const phase = document.getElementById('stage-phase');
  const text = nodeLabel(run);
  const medical = medicalUsesText(run);
  if (badge) badge.textContent = text;
  if (phase) phase.textContent = `${text}${medical ? ` · ${medical}` : ''} · 已推进 ${run.nodeIndex} 个节点`;
}

/** 当前阶段进度条 */
function renderProgress(s, now) {
  const run = s.run;
  const box = document.getElementById('stage-progress');
  if (!box) return;

  let label = '';
  let ratio = 0;
  let color = 'bg-delta';

  if (run.phase === PHASE.MARCH) {
    label = '推进至下一节点';
    ratio = phaseProgress(run, now);
  } else if (run.phase === PHASE.SCAVENGE) {
    label = `搜刮 ${run.node?.name || '补给箱'}`;
    ratio = phaseProgress(run, now);
    color = 'bg-sky-400';
  } else if (run.phase === PHASE.COMBAT) {
    const e = run.node?.enemy;
    label = `交战 ${e?.name || '敌人'}`;
    ratio = e && e.maxHp > 0 ? 1 - e.hp / e.maxHp : 0;
    color = 'bg-rust';
  } else if (run.phase === PHASE.EXTRACTING) {
    label = '撤离读条';
    ratio = extractProgress(s, now);
    color = 'bg-sky-400';
  }

  const w = Math.max(0, Math.min(100, ratio * 100));
  box.innerHTML = `
    <div class="flex justify-between text-[10px] text-sand/50 mb-1">
      <span>${esc(label)}</span><span>${w.toFixed(0)}%</span>
    </div>
    <div class="bar-track h-1.5 border border-line">
      <div class="bar-fill ${color} h-full" style="width:${w}%"></div>
    </div>
  `;
}

/** 视图隐藏时暂停动画（技术约束 7） */
export function pauseStage() {
  stageEl = stageEl || document.getElementById('stage');
  if (stageEl) stageEl.classList.add('is-paused');
}

export function resumeStage() {
  stageEl = stageEl || document.getElementById('stage');
  if (stageEl) stageEl.classList.remove('is-paused');
}
