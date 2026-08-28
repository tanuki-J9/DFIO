/**
 * 干员编成模块
 * 列表按定位（突击 / 支援 / 工程 / 侦察）分组横向排布，每格为一个像素小人方块头像
 * 已选定的干员右上角显示绿点，未放出的干员整体置灰并在右下角显示小锁且不可选定
 * 上阵上限 3 名、禁止重复、定位协同展示
 */

import { ROLE_META, ROLE_ORDER, SQUAD_LIMIT } from '../../config/index.js';
import { getState } from '../../core/state.js';
import { fmt, esc } from '../../core/utils.js';
import {
  operatorListView, activeSynergies, squadCombatStats,
  recruit, upgradeOperator, toggleSquad
} from '../../systems/operator.js';
import { toast, statCard, openPanel } from '../components.js';
import { avatarArt } from '../pixelAvatar.js';

export function renderOperatorPanel() {
  const s = getState();
  const list = operatorListView(s);
  const squad = list.filter((o) => o.inSquad);
  const synergies = activeSynergies(s);
  const stats = squadCombatStats(s);

  const groups = ROLE_ORDER.map((role) => ({
    role,
    meta: ROLE_META[role],
    list: list.filter((o) => o.role === role && !o.hidden)
  }));

  const hiddenList = list.filter((o) => o.hidden);

  const openCount = list.filter((o) => o.unlocked).length;

  return `
    <div class="space-y-4">
      <div>
        <p class="text-[11px] text-sand/45 leading-relaxed mb-2.5">
          当前共放出 <span class="text-delta">${openCount}</span> 名干员，
          点击头像即可上阵 / 下阵，带小锁的为尚未放出的干员，不可选定。
        </p>
        <div class="op-roster">
          ${groups.map(renderRoleGroup).join('')}
        </div>
      </div>

      ${hiddenList.length ? renderHiddenSection(hiddenList) : ''}

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="clip-corner bg-panel2 border border-line p-3">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs text-delta tracking-wider">当前编成</h3>
            <span class="text-[10px] ${squad.length > 0 ? 'text-delta' : 'text-rust'}">${squad.length} / ${SQUAD_LIMIT}</span>
          </div>
          <div class="grid grid-cols-3 gap-2">
            ${Array.from({ length: SQUAD_LIMIT }).map((_, i) => renderSquadSlot(squad[i], i)).join('')}
          </div>
          ${squad.length === 0 ? `<p class="mt-2 text-[10px] text-rust">至少上阵 1 名干员才能出发</p>` : ''}
        </div>

        <div class="clip-corner bg-panel2 border border-line p-3">
          <h3 class="text-xs text-delta tracking-wider mb-2">小队战斗属性</h3>
          <div class="grid grid-cols-3 gap-2">
            ${statCard({ label: '攻击', value: fmt(stats.atk), tone: 'rust' })}
            ${statCard({ label: '生命', value: fmt(stats.hp), tone: 'delta' })}
            ${statCard({ label: '防御', value: fmt(stats.def), tone: 'sky' })}
          </div>
          <p class="text-[10px] text-sand/40 mt-2 leading-relaxed">
            战斗属性由干员、装备、协同与技能共同决定，<span class="text-sand/70">不影响战备数值</span>。
          </p>
        </div>

        <div class="clip-corner bg-panel2 border border-line p-3">
          <h3 class="text-xs text-delta tracking-wider mb-2">定位协同</h3>
          ${synergies.length ? `
            <div class="space-y-2">
              ${synergies.map((sy) => `
                <div class="clip-tab bg-delta/10 border border-delta/40 px-2.5 py-1.5">
                  <p class="text-[11px] text-delta">${esc(sy.name)} ×${sy.count}</p>
                  <p class="text-[10px] text-sand/55 mt-0.5">${esc(sy.roleName)}协同 · ${esc(sy.text)}</p>
                </div>
              `).join('')}
            </div>
          ` : `<p class="text-[10px] text-sand/40 leading-relaxed">编成中出现 2 名及以上相同定位的干员即可激活对应协同效果。</p>`}
        </div>
      </div>
    </div>
  `;
}

/* ============ 定位分组 ============ */

function renderRoleGroup(group) {
  const openCount = group.list.filter((o) => o.unlocked).length;

  return `
    <section>
      <header class="flex items-baseline gap-2 mb-2">
        <h3 class="text-sm text-sand tracking-[0.2em] whitespace-nowrap">${esc(group.meta.name)}</h3>
        <span class="text-[10px] text-sand/35 whitespace-nowrap">${openCount}/${group.list.length}</span>
      </header>
      <div class="op-row">
        ${group.list.map(renderOperatorTile).join('')}
      </div>
    </section>
  `;
}

/** 单个干员方块头像 */
function renderOperatorTile(op) {
  const soon = op.comingSoon;

  // 未放出：整体置灰 + 右下角小锁，禁用点击
  if (soon) {
    return `
      <div class="op-tile op-tile-locked clip-tab border border-line bg-panel2 relative" title="尚未放出">
        <div class="op-tile-art">${avatarArt(op, true)}</div>
        <span class="op-lock" aria-label="未放出">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" class="w-3 h-3">
            <rect x="4" y="10.5" width="16" height="10.5" rx="1.5" fill="currentColor" stroke="none"/>
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="op-role-mark text-sand/30">${group_mark(op)}</span>
        <span class="op-tile-name text-sand/25">未放出</span>
      </div>
    `;
  }

  return `
    <div class="op-tile-wrap relative">
      <button data-action="op-toggle" data-id="${op.id}"
        class="btn op-tile clip-tab border ${op.inSquad ? 'border-delta' : `bd-${op.rarity}`} bg-panel2 relative"
        title="${esc(op.name)} · ${esc(op.roleFullName)}">
        <div class="op-tile-art">${avatarArt(op, false)}</div>
        ${op.inSquad ? `<span class="op-dot" aria-label="已上阵"></span>` : ''}
        <span class="op-role-mark ${op.inSquad ? 'text-delta' : 'text-sand/55'}">${group_mark(op)}</span>
        <span class="op-tile-name ${op.inSquad ? 'text-delta' : `rar-${op.rarity}`}">${esc(op.name)}</span>
      </button>
      <button data-action="op-detail" data-id="${op.id}"
        class="btn op-info" title="查看 ${esc(op.name)} 技能档案" aria-label="技能档案">?</button>
    </div>
  `;
}

/** 定位角标符号 */
function group_mark(op) {
  return op.roleMark || ROLE_META[op.role]?.mark || '▲';
}

/* ============ 编成席位 ============ */

function renderSquadSlot(op, idx) {
  if (!op) {
    return `
      <div class="clip-tab border border-dashed border-line bg-panel/50 flex flex-col items-center justify-center py-3 text-sand/25">
        <span class="text-base leading-none">＋</span>
        <span class="text-[10px] mt-1">席位 ${idx + 1}</span>
      </div>
    `;
  }
  return `
    <button data-action="op-toggle" data-id="${op.id}"
      class="btn clip-tab border border-delta/60 bg-delta/10 relative overflow-hidden py-1.5 flex flex-col items-center"
      title="点击下阵">
      <div class="w-10 h-10">${avatarArt(op, false)}</div>
      <span class="text-[10px] text-delta mt-1 truncate max-w-full px-1">${esc(op.name)}</span>
      <span class="text-[9px] text-sand/40">Lv.${op.level}</span>
    </button>
  `;
}

/* ============ 隐藏档案 ============ */

function renderHiddenSection(hiddenList) {
  return `
    <div class="clip-corner bg-panel2 border border-rust/40 p-3">
      <div class="flex items-baseline gap-2 mb-2">
        <h3 class="text-xs text-rust tracking-wider">隐藏档案</h3>
        <span class="text-[10px] text-sand/35">${hiddenList.length} 份 · 不可解锁</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        ${hiddenList.map(renderHiddenCard).join('')}
      </div>
    </div>
  `;
}

function renderHiddenCard(op) {
  return `
    <button data-action="op-hidden" data-id="${op.id}"
      class="btn op-hidden-card clip-tab border border-rust/45 bg-panel/60 p-2.5 flex gap-2.5 items-center text-left"
      title="${esc(op.name)} · ${esc(op.title || '隐藏角色')}">
      <div class="w-14 h-14 shrink-0 clip-tab border border-rust/40 bg-panel2 op-hidden-art">${avatarArt(op, false)}</div>
      <div class="grow min-w-0">
        <div class="flex items-center gap-1.5">
          <span class="text-[12px] text-rust truncate">${esc(op.name)}</span>
          <span class="text-[9px] text-rust/70 border border-rust/40 px-1 leading-[14px] whitespace-nowrap">隐藏</span>
        </div>
        <p class="text-[10px] text-sand/45 mt-0.5 truncate">${esc(op.title || '隐藏角色')}</p>
        <p class="text-[10px] text-sand/60 italic mt-1 truncate">「${esc(op.quote)}」</p>
      </div>
    </button>
  `;
}

/* ============ 技能文案 ============ */

function renderPassiveRow(op) {
  if (!op.passive) return '';
  return `
    <div class="clip-tab border border-delta/35 bg-delta/10 px-2.5 py-1.5 flex gap-2 items-start">
      <span class="text-sm leading-none mt-0.5">${esc(op.passive.icon || '◈')}</span>
      <div class="min-w-0">
        <p class="text-[11px] text-delta">
          ${esc(op.passive.name)}
          <span class="text-[9px] text-sand/45 ml-1">${esc(op.roleName)}基础技能</span>
        </p>
        <p class="text-[10px] text-sand/55 mt-0.5 leading-relaxed">${esc(op.passive.desc)}</p>
      </div>
    </div>
  `;
}

function renderSkillRow(sk) {
  const tone = sk.kindTone === 'rust' ? 'rust' : 'sky';
  return `
    <div class="clip-tab border border-line bg-panel/60 px-2.5 py-1.5 flex gap-2 items-start">
      <span class="text-sm leading-none mt-0.5">${esc(sk.icon || '◆')}</span>
      <div class="min-w-0 grow">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-[11px] text-sand">${esc(sk.name)}</span>
          <span class="text-[9px] text-${tone} border border-${tone}/45 px-1 leading-[14px]">${esc(sk.kindTag)}</span>
          <span class="text-[9px] text-sand/35">${esc(sk.slot || '')}</span>
          ${sk.range ? `<span class="text-[9px] text-sand/45">距离 ${esc(sk.range)}</span>` : ''}
        </div>
        <p class="text-[10px] text-sand/55 mt-0.5 leading-relaxed">${esc(sk.desc)}</p>
      </div>
    </div>
  `;
}

function renderSkillBlock(op) {
  const passive = renderPassiveRow(op);
  const skills = Array.isArray(op.skills) ? op.skills : [];
  if (!passive && !skills.length) return '';
  return `
    <div class="mt-3">
      <h4 class="text-[11px] text-delta tracking-wider mb-1.5">技能档案</h4>
      <div class="space-y-1.5">
        ${passive}
        ${skills.map(renderSkillRow).join('')}
      </div>
      <p class="text-[9px] text-sand/30 mt-1.5">专属技能将在行动中按冷却自动释放；定位基础技能为常驻被动。</p>
    </div>
  `;
}

/* ============ 交互处理 ============ */

export function handleToggleSquad(opId) {
  const r = toggleSquad(opId);
  toast(r.msg, r.ok ? 'ok' : 'err');
}

export function handleUpgradeOperator(opId) {
  const r = upgradeOperator(opId);
  toast(r.msg, r.ok ? 'ok' : 'err');
}

export function handleRecruit(opId) {
  const r = recruit(opId);
  toast(r.msg, r.ok ? 'ok' : 'err');
}

/** 干员详情弹窗：属性、定位说明与升级入口 */
export function handleOperatorDetail(opId) {
  const op = operatorListView().find((o) => o.id === opId);
  if (op && op.hidden) {
    handleHiddenDetail(opId);
    return;
  }
  if (!op || op.comingSoon) {
    toast('该干员尚未放出', 'warn');
    return;
  }

  openPanel({
    title: `${op.name} · ${op.roleFullName}`,
    bodyHtml: `
      <div class="flex flex-wrap gap-4">
        <div class="w-24 h-24 clip-tab border bd-${op.rarity} bg-panel2 shrink-0">${avatarArt(op, false)}</div>
        <div class="grow min-w-[200px]">
          <p class="text-sm rar-${op.rarity}">${esc(op.name)}</p>
          <p class="text-[11px] text-sand/45 mt-0.5">
            ${esc(op.roleFullName)} · ${esc(op.rarityName)} · Lv.${op.level}/${op.maxLevel}
          </p>
          <p class="text-[11px] text-sand/40 italic mt-2">「${esc(op.quote)}」</p>
          <div class="grid grid-cols-3 gap-2 mt-3">
            ${statCard({ label: '攻击', value: fmt(op.stats.atk), tone: 'rust' })}
            ${statCard({ label: '生命', value: fmt(op.stats.hp), tone: 'delta' })}
            ${statCard({ label: '防御', value: fmt(op.stats.def), tone: 'sky' })}
          </div>
          <p class="text-[11px] text-sand/50 mt-3 leading-relaxed">
            ${esc(ROLE_META[op.role].bias)} · ${esc(ROLE_META[op.role].desc)}
          </p>
        </div>
      </div>
      ${renderSkillBlock(op)}
    `
  });
}

/** 隐藏角色详情弹窗：仅展示档案文案，无任何解锁入口 */
export function handleHiddenDetail(opId) {
  const op = operatorListView().find((o) => o.id === opId);
  if (!op || !op.hidden) {
    toast('档案不存在', 'warn');
    return;
  }

  openPanel({
    title: `${op.name} · 隐藏档案`,
    bodyHtml: `
      <div class="flex flex-wrap gap-4">
        <div class="w-24 h-24 clip-tab border border-rust/50 bg-panel2 shrink-0 op-hidden-art">${avatarArt(op, false)}</div>
        <div class="grow min-w-[200px]">
          <div class="flex items-center gap-2">
            <p class="text-sm text-rust">${esc(op.name)}</p>
            <span class="text-[9px] text-rust/80 border border-rust/45 px-1 leading-[14px]">隐藏角色</span>
          </div>
          <p class="text-[11px] text-sand/45 mt-0.5">${esc(op.title || '不可解锁 · 隐藏角色')}</p>
          <p class="text-sm text-rust/90 italic mt-2 tracking-wider">「${esc(op.quote)}」</p>
          <p class="text-[11px] text-sand/60 mt-3 leading-relaxed">${esc(op.intro || '')}</p>
        </div>
      </div>
      <div class="mt-3 clip-tab border border-rust/40 bg-rust/10 px-2.5 py-2">
        <p class="text-[11px] text-rust">档案受限</p>
        <p class="text-[10px] text-sand/55 mt-1 leading-relaxed">${esc(op.hiddenNote || '该角色无法解锁或编成。')}</p>
      </div>
      <div class="mt-3">
        <h4 class="text-[11px] text-delta tracking-wider mb-1.5">技能档案</h4>
        <div class="clip-tab border border-line bg-panel/60 px-2.5 py-2">
          <p class="text-[10px] text-sand/45 leading-relaxed">技能效果未开放，当前仅收录角色设定文案。</p>
        </div>
      </div>
    `
  });
}
