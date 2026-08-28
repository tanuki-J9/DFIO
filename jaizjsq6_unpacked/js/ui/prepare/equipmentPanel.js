/**
 * 装备配置模块
 * 槽位穿卸、仓库、商店；即时反馈战备变化，不提供强化
 */

import { SLOTS, RARITY_META, getTemplate, getAmmo, LEVELED_SLOTS, AMMO_PACK_SIZES, AMMO_CARRY_MAX } from '../../config/index.js';
import { getState, notify } from '../../core/state.js';
import { fmt, esc } from '../../core/utils.js';
import { readinessBreakdown, getReadiness } from '../../systems/readiness.js';
import { operatorListView } from '../../systems/operator.js';
import {
  candidatesForSlot, equip, unequip, unequipAll, autoEquipBest, autoEquipSquad,
  operatorGearStats, allEquippedUids, holderOf,
  shopEquipmentList, shopMaterialList, shopAmmoList,
  buyEquipment, buyMaterial, buyAmmo, sellAmmo, sellEquipment
} from '../../systems/equipment.js';
import {
  ammoStock, totalAmmoRounds, normalizeAmmoLoadout, selectAmmo, setCarryRounds,
  ROUNDS_FOR_FULL_RUN, penetrationLabel
} from '../../systems/ammo.js';
import { avatarArt } from '../pixelAvatar.js';
import { toast, emptyState, openPanel, delegate, statCard, confirmDialog } from '../components.js';

let subTab = 'loadout';
/** 当前正在配装的干员；null 表示自动取首位上阵干员 */
let activeOp = null;

export function setEquipSubTab(id) {
  subTab = ['loadout', 'ammo', 'inventory', 'shop'].includes(id) ? id : 'loadout';
}

export function setEquipOperator(opId) {
  activeOp = opId || null;
}

/** 当前配装对象：优先手选，其次首位上阵干员 */
function currentOp(s) {
  const squad = (s.operators.squad || []).filter(Boolean);
  if (activeOp && squad.includes(activeOp)) return activeOp;
  activeOp = squad[0] || null;
  return activeOp;
}

export function getEquipOperator() {
  return currentOp(getState());
}

const SUB_TABS = [
  { id: 'loadout', name: '配装', icon: '🎯' },
  { id: 'ammo', name: '弹药', icon: '🧨' },
  { id: 'inventory', name: '仓库', icon: '📦' },
  { id: 'shop', name: '商店', icon: '🏪' }
];

export function renderEquipmentPanel() {
  const s = getState();
  return `
    <div class="flex flex-wrap gap-2 mb-4">
      ${SUB_TABS.map((t) => `
        <button data-action="eq-subtab" data-sub="${t.id}"
          class="btn clip-tab px-3 py-1.5 text-[11px] border ${subTab === t.id ? 'border-delta bg-delta/15 text-delta' : 'border-line bg-panel2 text-sand/60 hover:text-sand'}">
          ${t.icon} ${esc(t.name)}
        </button>
      `).join('')}
    </div>
    ${subTab === 'loadout' ? renderLoadout(s) : ''}
    ${subTab === 'ammo' ? renderAmmoPanel(s) : ''}
    ${subTab === 'inventory' ? renderInventory(s) : ''}
    ${subTab === 'shop' ? renderShop(s) : ''}
  `;
}

/* ============ 配装（按干员分别配置） ============ */

function renderLoadout(s) {
  const all = operatorListView(s);
  const squad = (s.operators.squad || [])
    .map((id) => all.find((o) => o.id === id))
    .filter(Boolean);

  if (!squad.length) {
    return emptyState('尚未上阵任何干员。装备需要按干员分别配置，请先前往「干员编成」上阵干员。', '🎖️');
  }

  const opId = currentOp(s);
  const op = squad.find((o) => o.id === opId) || squad[0];
  const rows = readinessBreakdown(op.id, s);
  const mine = operatorGearStats(op.id, s);
  const total = getReadiness(s);

  return `
    <div class="mb-3">
      <p class="text-[11px] text-sand/50 mb-2 leading-relaxed">
        每名干员各自携带一套装备，同一件装备只能由一人携带。全队战备为所有上阵干员装备价值之和：
        <span class="text-delta">${fmt(total)}</span>。弹药按发单独携带，<span class="text-amber-400">不计入战备</span>，请在「弹药」页配置。
      </p>
      <div class="eq-op-tabs">
        ${squad.map((o) => {
          const g = operatorGearStats(o.id, s);
          const on = o.id === op.id;
          return `
            <button data-action="eq-op" data-id="${o.id}"
              class="btn eq-op-tab clip-tab border ${on ? 'border-delta bg-delta/12' : 'border-line bg-panel2 hover:brightness-125'}">
              <span class="eq-op-face">${avatarArt(o, false)}</span>
              <span class="min-w-0 text-left">
                <span class="block text-[11px] ${on ? 'text-delta' : 'text-sand/70'} truncate">${esc(o.name)}</span>
                <span class="block text-[9px] text-sand/40 truncate">${esc(o.roleName)} · ${g.count}/${SLOTS.length} 件</span>
              </span>
              <span class="text-[10px] ${g.value ? 'text-delta' : 'text-sand/30'} shrink-0">+${fmt(g.value)}</span>
            </button>
          `;
        }).join('')}
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <aside class="space-y-3">
        <div class="clip-corner bg-panel2 border border-delta/40 p-3">
          <div class="flex items-center gap-2.5">
            <span class="eq-op-face-lg clip-tab border bd-${op.rarity}">${avatarArt(op, false)}</span>
            <div class="min-w-0">
              <p class="text-sm rar-${op.rarity} truncate">${esc(op.name)}</p>
              <p class="text-[10px] text-sand/45">${esc(op.roleFullName)} · Lv.${op.level}</p>
            </div>
          </div>
          <p class="text-[10px] text-sand/45 tracking-wider mt-3">该干员装备价值</p>
          <p class="text-3xl text-delta leading-tight mt-0.5">${fmt(mine.value)}</p>
          <p class="text-[10px] text-sand/40 mt-1 leading-relaxed">
            带得越好越能进高难度，撤离失败时损失也越大。
          </p>
        </div>
        <div class="clip-corner bg-panel2 border border-line p-3">
          <h3 class="text-xs text-delta tracking-wider mb-2">该干员装备加成</h3>
          <div class="grid grid-cols-3 gap-2">
            ${statCard({ label: '攻击', value: fmt(mine.atk), tone: 'rust' })}
            ${statCard({ label: '生命', value: fmt(mine.hp), tone: 'delta' })}
            ${statCard({ label: '防御', value: fmt(mine.def), tone: 'sky' })}
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button data-action="eq-auto" class="btn clip-tab text-[11px] py-2 border border-delta/50 text-delta hover:bg-delta/15">本干员最优</button>
          <button data-action="eq-auto-squad" class="btn clip-tab text-[11px] py-2 border border-delta/50 text-delta hover:bg-delta/15">全队最优</button>
          <button data-action="eq-clear" class="btn clip-tab text-[11px] py-2 border border-rust/50 text-rust hover:bg-rust/15">卸下本干员</button>
          <button data-action="eq-clear-all" class="btn clip-tab text-[11px] py-2 border border-rust/50 text-rust hover:bg-rust/15">卸下全队</button>
        </div>
      </aside>

      <div class="xl:col-span-2 grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
        ${rows.map((row) => renderSlotCard(row, op.id)).join('')}
      </div>
    </div>
  `;
}

function renderSlotCard(row, opId) {
  const has = !!row.tplId;
  const tpl = has ? getTemplate(row.tplId) : null;
  const lv = has && LEVELED_SLOTS.includes(row.slot) ? (tpl.level || 0) : 0;
  return `
    <article class="clip-corner bg-panel border ${has ? `bd-${row.rarity}` : 'border-dashed border-line'} p-3">
      <header class="flex items-center justify-between gap-2 mb-2">
        <span class="flex items-center gap-1.5 text-[11px] text-sand/55">
          <span class="text-base">${row.icon}</span>${esc(row.slotName)}
        </span>
        <span class="flex items-center gap-1.5 shrink-0">
          ${lv ? `<span class="text-[10px] px-1.5 py-0.5 border border-delta/50 text-delta clip-tab">${lv} 级</span>` : ''}
          <span class="text-[11px] ${has ? 'text-delta' : 'text-sand/30'}">+${fmt(row.value)}</span>
        </span>
      </header>
      ${has ? `
        <p class="text-xs rar-${row.rarity} truncate">${esc(row.name)}</p>
        <p class="text-[10px] text-sand/45 mt-0.5">${esc(RARITY_META[row.rarity].name)}</p>
        <div class="grid grid-cols-3 gap-1 mt-2 text-[10px]">
          <span class="text-sand/45">攻 <span class="text-rust">${fmt(tpl.atk)}</span></span>
          <span class="text-sand/45">生 <span class="text-delta">${fmt(tpl.hp)}</span></span>
          <span class="text-sand/45">防 <span class="text-sky-400">${fmt(tpl.def)}</span></span>
        </div>
      ` : `<p class="text-xs text-sand/30 py-2">未装备</p>`}
      <footer class="flex gap-2 mt-3">
        <button data-action="eq-pick" data-slot="${row.slot}" data-id="${esc(opId)}"
          class="btn flex-1 clip-tab text-[11px] py-1.5 border border-delta/50 text-delta hover:bg-delta/15">更换</button>
        ${has ? `<button data-action="eq-unequip" data-slot="${row.slot}" data-id="${esc(opId)}"
          class="btn clip-tab text-[11px] py-1.5 px-3 border border-rust/50 text-rust hover:bg-rust/15">卸下</button>` : ''}
      </footer>
    </article>
  `;
}

/* ============ 弹药（按发携带与采购） ============ */

function renderAmmoPanel(s) {
  const list = shopAmmoList(s);
  const picked = normalizeAmmoLoadout(s);
  const pickedTpl = picked.ammoId ? getAmmo(picked.ammoId) : null;
  const stock = picked.ammoId ? ammoStock(picked.ammoId, s) : 0;
  const total = totalAmmoRounds(s);
  const have = s.currency.hafCoin;
  const enough = picked.rounds >= ROUNDS_FOR_FULL_RUN;

  return `
    <div class="space-y-4">
      <section class="clip-corner bg-panel border border-delta/40 overflow-hidden">
        <header class="px-4 py-2.5 border-b border-line flex items-center justify-between gap-3">
          <h3 class="text-xs text-delta tracking-wider">🧨 本轮携带弹药</h3>
          <span class="text-[10px] text-sand/40">弹药按发计数，不占装备槽、不计入战备</span>
        </header>
        <div class="p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          ${statCard({
            label: '携带发数',
            value: `${fmt(picked.rounds)} 发`,
            sub: enough ? '可支撑全程开火' : `全程需 ${ROUNDS_FOR_FULL_RUN} 发`,
            tone: enough ? 'delta' : (picked.rounds > 0 ? 'amber' : 'rust')
          })}
          ${statCard({
            label: '当前弹种',
            value: pickedTpl ? `${pickedTpl.level} 级` : '未选',
            sub: pickedTpl ? pickedTpl.name : '请在下方选择弹种',
            tone: pickedTpl ? 'sand' : 'rust'
          })}
          ${statCard({ label: '该弹种库存', value: `${fmt(stock)} 发`, sub: '出发时按携带发数出库', tone: 'sky' })}
          ${statCard({ label: '全部弹药库存', value: `${fmt(total)} 发`, sub: `持有 ${fmt(have)} 哈夫币`, tone: 'amber' })}
        </div>
        ${pickedTpl ? `
          <div class="px-3 pb-3">
            <div class="clip-tab bg-panel2 border border-line px-3 py-2.5">
              <div class="flex items-center justify-between gap-2 mb-2">
                <span class="text-[11px] text-sand/60">携带发数调整（上限 ${AMMO_CARRY_MAX} 发）</span>
                <span class="text-[11px] text-delta">${fmt(picked.rounds)} / ${fmt(stock)} 发</span>
              </div>
              <div class="flex flex-wrap gap-2">
                ${[0, 60, 120, 180, 240, 360].map((n) => `
                  <button data-action="ammo-carry" data-n="${n}" ${n <= stock ? '' : 'disabled'}
                    class="btn clip-tab px-2.5 py-1 text-[10px] border ${picked.rounds === n ? 'border-delta bg-delta/15 text-delta' : 'border-line bg-panel text-sand/60 hover:text-sand'}">
                    ${n === 0 ? '不带弹' : `${n} 发`}
                  </button>
                `).join('')}
                <button data-action="ammo-carry-max"
                  class="btn clip-tab px-2.5 py-1 text-[10px] border border-delta/50 bg-delta/10 text-delta">带满库存</button>
              </div>
              <p class="text-[10px] text-sand/40 mt-2 leading-relaxed">
                ${esc(pickedTpl.name)} 单价 ${fmt(pickedTpl.pricePerRound)} 哈夫币 / 发 · 攻击加成 +${fmt(pickedTpl.atk)}。
                打空后枪械停火，小队只能靠技能作战；撤离成功时未打完的弹药会退回仓库。
              </p>
            </div>
          </div>
        ` : ''}
      </section>

      <section>
        <h3 class="text-xs text-delta tracking-wider mb-2">弹种一览 · 按发采购</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          ${list.map((t) => {
            const on = picked.ammoId === t.id;
            return `
              <article class="clip-tab bg-panel2 border ${on ? 'border-delta' : `bd-${t.rarity}`} px-3 py-2.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs rar-${t.rarity} truncate">${esc(t.name)}</span>
                  <span class="text-[10px] px-1.5 py-0.5 border border-delta/50 text-delta clip-tab shrink-0">${t.level} 级</span>
                </div>
                <p class="text-[10px] text-sand/45 mt-0.5">
                  ${esc(RARITY_META[t.rarity].name)} · 单价 <span class="text-amber-400">${fmt(t.pricePerRound)}</span> / 发 · 攻 +${fmt(t.atk)}
                </p>
                <p class="text-[10px] text-sand/50 mt-1">库存 <span class="text-sky-400">${fmt(t.stock)}</span> 发</p>
                <div class="flex flex-wrap gap-1.5 mt-2">
                  ${AMMO_PACK_SIZES.map((n) => `
                    <button data-action="ammo-buy" data-tpl="${t.id}" data-n="${n}"
                      ${have >= t.pricePerRound * n ? '' : 'disabled'}
                      class="btn clip-tab px-2 py-1 text-[10px] border border-amber-400/50 text-amber-400 hover:bg-amber-400/15"
                      title="${fmt(t.pricePerRound * n)} 哈夫币">
                      +${n}
                    </button>
                  `).join('')}
                </div>
                <div class="flex gap-2 mt-2">
                  <button data-action="ammo-select" data-tpl="${t.id}" ${t.stock > 0 ? '' : 'disabled'}
                    class="btn flex-1 clip-tab text-[10px] py-1 border ${on ? 'border-delta bg-delta/15 text-delta' : 'border-delta/50 text-delta hover:bg-delta/15'}">
                    ${on ? '携带中' : '选为携带'}
                  </button>
                  <button data-action="ammo-sell" data-tpl="${t.id}" ${t.stock > 0 ? '' : 'disabled'}
                    class="btn clip-tab text-[10px] py-1 px-2 border border-rust/40 text-rust hover:bg-rust/15">出售 30</button>
                </div>
              </article>
            `;
          }).join('')}
        </div>
      </section>

      <section>
        <h3 class="text-xs text-delta tracking-wider mb-2">穿透对照 · 当前弹种对各级防具</h3>
        <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          ${[1, 2, 3, 4, 5, 6].map((lv) => {
            const label = pickedTpl ? penetrationLabel(pickedTpl.level, lv) : '未选定弹种';
            const diff = pickedTpl ? pickedTpl.level - lv : 0;
            const tone = !pickedTpl ? 'sand' : (diff >= 0 ? 'delta' : (diff >= -2 ? 'amber' : 'rust'));
            return statCard({ label: `对 ${lv} 级防具`, value: label.split(' · ')[1] || label, sub: label.split(' · ')[0], tone });
          }).join('')}
        </div>
      </section>
    </div>
  `;
}

/** 槽位选择弹窗 */
export function openSlotPicker(slotId, opId = null) {
  const s = getState();
  const target = opId || currentOp(s);
  if (!target) {
    toast('请先上阵干员后再配置装备', 'err');
    return;
  }
  const slotMeta = SLOTS.find((x) => x.id === slotId);
  const opName = operatorListView(s).find((o) => o.id === target)?.name || '';
  const list = candidatesForSlot(slotId, target, s);

  const body = list.length ? `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
      ${list.map((it) => `
        <button data-action="pick-equip" data-uid="${it.uid}"
          class="btn text-left clip-tab bg-panel2 border ${it.equipped ? 'border-delta' : `bd-${it.rarity}`} px-3 py-2 hover:brightness-125">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs rar-${it.rarity} truncate">${esc(it.name)}</span>
            <span class="text-[11px] text-delta shrink-0">+${fmt(it.value)}</span>
          </div>
          <div class="grid grid-cols-4 gap-1 mt-1 text-[10px]">
            <span class="text-sand/40">${esc(it.rarityName)}</span>
            <span class="text-sand/45">攻 <span class="text-rust">${fmt(it.atk)}</span></span>
            <span class="text-sand/45">生 <span class="text-delta">${fmt(it.hp)}</span></span>
            <span class="text-sand/45">防 <span class="text-sky-400">${fmt(it.def)}</span></span>
          </div>
          ${it.equipped ? `<p class="text-[10px] text-delta mt-1">当前已装备</p>` : ''}
        </button>
      `).join('')}
    </div>
  ` : emptyState('仓库中没有该槽位的可用装备（他人携带中的装备不可选），可前往商店购买', '🛒');

  openPanel({
    title: `${esc(opName)} · 选择${slotMeta?.name || '装备'}`,
    bodyHtml: body,
    wide: true,
    onMount: (el, close) => {
      delegate(el, {
        'pick-equip': ({ uid }) => {
          const r = equip(uid, target);
          if (r.ok) {
            toast(`已装备，战备 ${fmt(r.before)} → ${fmt(r.after)}`, 'ok');
            close();
          } else {
            toast(r.msg, 'err');
          }
        }
      });
    }
  });
}

/* ============ 仓库 ============ */

function renderInventory(s) {
  const equipped = allEquippedUids(s);
  const all = operatorListView(s);
  const nameOf = (opId) => all.find((o) => o.id === opId)?.name || '干员';
  const target = currentOp(s);
  const targetName = target ? nameOf(target) : '';

  const groups = SLOTS.map((slot) => ({
    slot,
    items: s.inventory
      .filter((it) => it.slot === slot.id)
      .map((it) => ({
        ...it,
        tpl: getTemplate(it.tplId),
        equipped: equipped.has(it.uid),
        holder: equipped.has(it.uid) ? holderOf(it.uid, s) : null
      }))
      .filter((it) => it.tpl)
      .sort((a, b) => b.tpl.value - a.tpl.value)
  }));

  const mats = Object.entries(s.materials).filter(([, n]) => n > 0);

  return `
    <div class="space-y-4">
      <p class="text-[11px] text-sand/50 leading-relaxed">
        ${target
          ? `点击「装备」将把该装备穿到当前配装干员 <span class="text-delta">${esc(targetName)}</span> 身上，可在「配装」页切换干员。`
          : '尚未上阵干员，请先前往「干员编成」上阵后再配置装备。'}
      </p>

      ${groups.map(({ slot, items }) => `
        <section>
          <h3 class="text-xs text-delta tracking-wider mb-2">${slot.icon} ${esc(slot.name)} <span class="text-sand/35">(${items.length})</span></h3>
          ${items.length ? `
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
              ${items.map((it) => `
                <div class="clip-tab bg-panel2 border ${it.equipped ? 'border-delta' : `bd-${it.tpl.rarity}`} px-3 py-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs rar-${it.tpl.rarity} truncate">${esc(it.tpl.name)}</span>
                    <span class="text-[11px] text-delta shrink-0">+${fmt(it.tpl.value)}</span>
                  </div>
                  <div class="grid grid-cols-3 gap-1 mt-1 text-[10px]">
                    <span class="text-sand/45">攻 <span class="text-rust">${fmt(it.tpl.atk)}</span></span>
                    <span class="text-sand/45">生 <span class="text-delta">${fmt(it.tpl.hp)}</span></span>
                    <span class="text-sand/45">防 <span class="text-sky-400">${fmt(it.tpl.def)}</span></span>
                  </div>
                  <div class="flex gap-2 mt-2">
                    ${it.equipped
                      ? `<span class="flex-1 text-center text-[10px] text-delta py-1 truncate">${esc(nameOf(it.holder))} 携带中</span>
                         ${it.holder !== target && target ? `<button data-action="eq-equip-uid" data-uid="${it.uid}" class="btn clip-tab text-[10px] py-1 px-2 border border-delta/40 text-delta hover:bg-delta/15">转给${esc(targetName)}</button>` : ''}`
                      : `<button data-action="eq-equip-uid" data-uid="${it.uid}" ${target ? '' : 'disabled'} class="btn flex-1 clip-tab text-[10px] py-1 border border-delta/50 text-delta hover:bg-delta/15">装备</button>
                         <button data-action="eq-sell" data-uid="${it.uid}" class="btn clip-tab text-[10px] py-1 px-2 border border-rust/40 text-rust hover:bg-rust/15">出售</button>`}
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `<p class="text-[11px] text-sand/35 py-2">暂无</p>`}
        </section>
      `).join('')}

      <section>
        <h3 class="text-xs text-delta tracking-wider mb-2">🧨 弹药储备 <span class="text-sand/35">(${fmt(totalAmmoRounds(s))} 发)</span></h3>
        ${totalAmmoRounds(s) > 0 ? `
          <div class="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-2">
            ${shopAmmoList(s).filter((t) => t.stock > 0).map((t) => `
              <div class="clip-tab bg-panel2 border bd-${t.rarity} px-3 py-2">
                <p class="text-xs rar-${t.rarity} truncate">${esc(t.name)}</p>
                <p class="text-[10px] text-sand/45 mt-0.5">${t.level} 级 · ${fmt(t.stock)} 发</p>
                <p class="text-[10px] text-delta mt-0.5">单价 ${fmt(t.pricePerRound)} / 发</p>
              </div>
            `).join('')}
          </div>
        ` : `<p class="text-[11px] text-sand/35 py-2">暂无弹药，可前往「弹药」页按发采购</p>`}
      </section>

      <section>
        <h3 class="text-xs text-delta tracking-wider mb-2">🧪 制作材料 <span class="text-sand/35">(${mats.length})</span></h3>
        ${mats.length ? `
          <div class="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-6 gap-2">
            ${mats.map(([id, n]) => {
              const mat = shopMaterialList().find((m) => m.id === id);
              if (!mat) return '';
              return `
                <div class="clip-tab bg-panel2 border bd-${mat.rarity} px-3 py-2">
                  <p class="text-xs rar-${mat.rarity} truncate">${esc(mat.name)}</p>
                  <p class="text-[10px] text-sand/45 mt-0.5">${esc(RARITY_META[mat.rarity].name)} · ×${n}</p>
                  <p class="text-[10px] text-delta mt-0.5">单价值 ${fmt(mat.value)}</p>
                </div>
              `;
            }).join('')}
          </div>
        ` : `<p class="text-[11px] text-sand/35 py-2">暂无材料</p>`}
      </section>
    </div>
  `;
}

/* ============ 商店 ============ */

function renderShop(s) {
  const eq = shopEquipmentList();
  const mats = shopMaterialList();
  const have = s.currency.hafCoin;

  return `
    <p class="text-[11px] text-sand/50 mb-3 leading-relaxed">
      哈夫币为通用货币，可用于购买装备、材料与各类升级。三角币仅用于皮肤等外观内容，不参与战备成长。
      弹药按发计价，请前往「弹药」页采购。当前持有 <span class="text-amber-400">${fmt(have)}</span> 哈夫币。
    </p>

    <h3 class="text-xs text-delta tracking-wider mb-2">🔫 装备</h3>
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2 mb-5">
      ${eq.map((t) => `
        <div class="clip-tab bg-panel2 border bd-${t.rarity} px-3 py-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs rar-${t.rarity} truncate">${esc(t.name)}</span>
            <span class="text-[11px] text-delta shrink-0">+${fmt(t.value)}</span>
          </div>
          <p class="text-[10px] text-sand/45 mt-0.5">${esc(RARITY_META[t.rarity].name)} · ${esc(SLOTS.find((x) => x.id === t.slot)?.name || '')}</p>
          <div class="grid grid-cols-3 gap-1 mt-1 text-[10px]">
            <span class="text-sand/45">攻 <span class="text-rust">${fmt(t.atk)}</span></span>
            <span class="text-sand/45">生 <span class="text-delta">${fmt(t.hp)}</span></span>
            <span class="text-sand/45">防 <span class="text-sky-400">${fmt(t.def)}</span></span>
          </div>
          <button data-action="shop-buy-eq" data-tpl="${t.id}" ${have >= t.price ? '' : 'disabled'}
            class="btn w-full clip-tab text-[10px] py-1.5 mt-2 border border-amber-400/50 text-amber-400 hover:bg-amber-400/15">
            ${fmt(t.price)} 哈夫币
          </button>
        </div>
      `).join('')}
    </div>

    <h3 class="text-xs text-delta tracking-wider mb-2">🧪 制作材料</h3>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
      ${mats.map((m) => `
        <div class="clip-tab bg-panel2 border bd-${m.rarity} px-3 py-2">
          <p class="text-xs rar-${m.rarity} truncate">${esc(m.name)}</p>
          <p class="text-[10px] text-sand/45 mt-0.5">${esc(RARITY_META[m.rarity].name)} · 价值 ${fmt(m.value)}</p>
          <button data-action="shop-buy-mat" data-tpl="${m.id}" ${have >= m.price ? '' : 'disabled'}
            class="btn w-full clip-tab text-[10px] py-1.5 mt-2 border border-amber-400/50 text-amber-400 hover:bg-amber-400/15">
            ${fmt(m.price)} 哈夫币
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

/* ============ 交互 ============ */

export function handleSelectEquipOperator(opId) {
  setEquipOperator(opId);
  notify();
}

export function handleEquipByUid(uidStr) {
  const s = getState();
  const target = currentOp(s);
  if (!target) {
    toast('请先上阵干员后再配置装备', 'err');
    return;
  }
  const r = equip(uidStr, target);
  if (!r.ok) {
    toast(r.msg, 'err');
    return;
  }
  const from = r.movedFrom
    ? `${operatorListView(s).find((o) => o.id === r.movedFrom)?.name || '他人'} → `
    : '';
  toast(`${from}已装备，战备 ${fmt(r.before)} → ${fmt(r.after)}`, 'ok');
}

export function handleUnequip(slotId, opId = null) {
  const target = opId || currentOp(getState());
  const r = unequip(slotId, target);
  toast(r.ok ? `已卸下，战备 ${fmt(r.before)} → ${fmt(r.after)}` : r.msg, r.ok ? 'ok' : 'err');
}

export function handleAutoEquip() {
  const target = currentOp(getState());
  const r = autoEquipBest(target);
  toast(r.ok ? `已自动配装，战备 ${fmt(r.before)} → ${fmt(r.after)}` : r.msg, r.ok ? 'ok' : 'err');
}

export function handleAutoEquipSquad() {
  const r = autoEquipSquad();
  toast(r.ok ? `全队已自动配装，战备 ${fmt(r.before)} → ${fmt(r.after)}` : r.msg, r.ok ? 'ok' : 'err');
}

export async function handleClearLoadout() {
  const s = getState();
  const target = currentOp(s);
  const name = operatorListView(s).find((o) => o.id === target)?.name || '该干员';
  const ok = await confirmDialog({
    title: `卸下 ${name} 的装备`,
    body: `将卸下 ${name} 身上的全部装备，全队战备随之下降。是否继续？`,
    okText: '确认卸下',
    danger: true
  });
  if (!ok) return;
  const r = unequipAll(target);
  toast(r.ok ? `已卸下，战备 ${fmt(r.before)} → ${fmt(r.after)}` : r.msg, r.ok ? 'ok' : 'err');
}

export async function handleClearAllLoadouts() {
  const ok = await confirmDialog({
    title: '卸下全队装备',
    body: '卸下后战备将归零，仅可进入普通行动。是否继续？',
    okText: '全部卸下',
    danger: true
  });
  if (!ok) return;
  const r = unequipAll(null);
  toast(r.ok ? `已全部卸下，战备 ${fmt(r.before)} → ${fmt(r.after)}` : r.msg, r.ok ? 'ok' : 'err');
}

export function handleBuyEquipment(tplId) {
  const r = buyEquipment(tplId);
  toast(r.msg, r.ok ? 'ok' : 'err');
}

export function handleBuyMaterial(tplId) {
  const r = buyMaterial(tplId, 1);
  toast(r.msg, r.ok ? 'ok' : 'err');
}

/* ============ 弹药交互 ============ */

export function handleBuyAmmo(ammoId, rounds) {
  const r = buyAmmo(ammoId, rounds);
  toast(r.msg, r.ok ? 'ok' : 'err');
}

export function handleSelectAmmo(ammoId) {
  const s = getState();
  const r = selectAmmo(ammoId, s);
  toast(r.msg, r.ok ? 'ok' : 'err');
  notify();
}

export function handleSetCarryRounds(rounds) {
  const s = getState();
  const r = setCarryRounds(rounds, s);
  toast(r.ok ? r.msg : r.msg, r.ok ? 'ok' : 'err');
  notify();
}

export function handleCarryMax() {
  const s = getState();
  const picked = normalizeAmmoLoadout(s);
  if (!picked.ammoId) {
    toast('请先选择弹种', 'err');
    return;
  }
  const r = setCarryRounds(Math.min(AMMO_CARRY_MAX, ammoStock(picked.ammoId, s)), s);
  toast(r.msg, r.ok ? 'ok' : 'err');
  notify();
}

export async function handleSellAmmo(ammoId) {
  const ok = await confirmDialog({
    title: '出售弹药',
    body: '将出售该弹种 30 发，按单发价值的 6 折回收哈夫币。是否继续？',
    okText: '确认出售',
    danger: true
  });
  if (!ok) return;
  const r = sellAmmo(ammoId, 30);
  toast(r.msg, r.ok ? 'ok' : 'err');
}

export async function handleSell(uidStr) {
  const ok = await confirmDialog({
    title: '出售装备',
    body: '出售后将按装备价值回收部分哈夫币，且该装备永久移除。是否继续？',
    okText: '确认出售',
    danger: true
  });
  if (!ok) return;
  const r = sellEquipment(uidStr);
  toast(r.msg, r.ok ? 'ok' : 'err');
}
