/**
 * 特勤处 · 仓库模块
 * 分类：装备 / 收藏品 / 材料
 * 装备保留出售与「装备给当前配装干员」的入口，收藏品与材料可出售
 */

import { RARITY, RARITY_META, SLOTS } from '../../config/index.js';
import { getState, notify } from '../../core/state.js';
import { fmt, esc } from '../../core/utils.js';
import { operatorListView } from '../../systems/operator.js';
import { sellEquipment, shopAmmoList, sellAmmo } from '../../systems/equipment.js';
import { totalAmmoRounds, normalizeAmmoLoadout } from '../../systems/ammo.js';
import {
  warehouseEquipment, warehouseCollectibles, warehouseMaterials, warehouseSummary,
  sellCollectible, sellMaterial
} from '../../systems/collection.js';
import { getEquipOperator } from './equipmentPanel.js';
import { toast, emptyState, statCard, delegate, confirmDialog, openPanel } from '../components.js';

const CATS = [
  { id: 'equipment', name: '装备', icon: '🔫' },
  { id: 'ammo', name: '弹药', icon: '🧨' },
  { id: 'collectible', name: '收藏品', icon: '🏺' },
  { id: 'material', name: '材料', icon: '🧪' }
];

let cat = 'equipment';

export function setWarehouseCat(id) {
  cat = CATS.some((c) => c.id === id) ? id : 'equipment';
}

export function renderWarehousePanel() {
  const s = getState();
  const sum = warehouseSummary(s);

  return `
    <section class="clip-corner bg-panel border border-line overflow-hidden mb-4">
      <header class="px-4 py-2.5 border-b border-line flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-base">📦</span>
          <h3 class="text-xs text-delta tracking-[0.2em]">仓库 · WAREHOUSE</h3>
        </div>
        <span class="text-[10px] text-sand/40 shrink-0">库存总价值 ${fmt(sum.totalValue)}</span>
      </header>
      <div class="p-3 grid grid-cols-2 md:grid-cols-5 gap-2">
        ${statCard({ label: '装备', value: `${sum.equipment.count} 件`, sub: `价值 ${fmt(sum.equipment.value)} · 携带中 ${sum.equipment.equipped}`, tone: 'delta' })}
        ${statCard({ label: '弹药', value: `${fmt(totalAmmoRounds(s))} 发`, sub: '按发计数 · 不计战备', tone: 'sky' })}
        ${statCard({ label: '收藏品', value: `${sum.collectible.count} 件`, sub: `${sum.collectible.kinds} 种 · 价值 ${fmt(sum.collectible.value)}`, tone: 'amber' })}
        ${statCard({ label: '材料', value: `${sum.material.count} 个`, sub: `${sum.material.kinds} 种 · 价值 ${fmt(sum.material.value)}`, tone: 'sky' })}
        ${statCard({ label: '哈夫币', value: fmt(s.currency.hafCoin), sub: '出售所得直接入账', tone: 'sand' })}
      </div>
    </section>

    <div class="flex flex-wrap gap-2 mb-4">
      ${CATS.map((c) => `
        <button data-action="wh-cat" data-cat="${c.id}"
          class="btn clip-tab px-3 py-1.5 text-[11px] border ${cat === c.id ? 'border-delta bg-delta/15 text-delta' : 'border-line bg-panel2 text-sand/60 hover:text-sand'}">
          ${c.icon} ${esc(c.name)}
        </button>
      `).join('')}
    </div>

    ${cat === 'equipment' ? renderEquipCat(s) : ''}
    ${cat === 'ammo' ? renderAmmoCat(s) : ''}
    ${cat === 'collectible' ? renderCollectCat(s) : ''}
    ${cat === 'material' ? renderMaterialCat(s) : ''}
  `;
}

/* ============ 弹药分类 ============ */

function renderAmmoCat(s) {
  const list = shopAmmoList(s).filter((t) => t.stock > 0);
  if (!list.length) {
    return emptyState('仓库内没有弹药。弹药按发计价，可在「装备配置 · 弹药」页采购', '🧨');
  }
  const picked = normalizeAmmoLoadout(s);

  return `
    <p class="text-[11px] text-sand/50 mb-3 leading-relaxed">
      弹药按发计数，不占装备槽也<span class="text-amber-400">不计入战备</span>。
      出发时按「携带发数」从仓库出库，撤离成功时未打完的弹药会退回；撤离失败则随其他物资一并损失。
    </p>
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
      ${list.map((t) => `
        <article class="clip-tab bg-panel2 border ${picked.ammoId === t.id ? 'border-delta' : `bd-${t.rarity}`} px-3 py-2.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs rar-${t.rarity} truncate">${esc(t.name)}</span>
            <span class="text-[10px] px-1.5 py-0.5 border border-delta/50 text-delta clip-tab shrink-0">${t.level} 级</span>
          </div>
          <p class="text-[10px] text-sand/45 mt-0.5">${esc(RARITY_META[t.rarity].name)} · 库存 ${fmt(t.stock)} 发</p>
          <p class="text-[10px] text-delta mt-0.5">
            单发价值 ${fmt(t.valuePerRound)} · 库存总价值 ${fmt(t.valuePerRound * t.stock)}
          </p>
          ${picked.ammoId === t.id ? `<p class="text-[10px] text-delta mt-1">本轮携带 ${fmt(picked.rounds)} 发</p>` : ''}
          <button data-action="wh-sell-ammo" data-tpl="${t.id}"
            class="btn w-full clip-tab text-[10px] py-1 mt-2 border border-rust/40 text-rust hover:bg-rust/15">出售 30 发</button>
        </article>
      `).join('')}
    </div>
  `;
}

/* ============ 装备分类 ============ */

function renderEquipCat(s) {
  const groups = warehouseEquipment(s);
  const all = operatorListView(s);
  const nameOf = (id) => all.find((o) => o.id === id)?.name || '干员';
  const target = getEquipOperator();
  const targetName = target ? nameOf(target) : '';
  const empty = groups.every((g) => !g.items.length);

  if (empty) return emptyState('仓库内没有任何装备，可前往「装备配置 · 商店」采购', '🛒');

  return `
    <p class="text-[11px] text-sand/50 mb-3 leading-relaxed">
      ${target
        ? `点击「装备」会穿到当前配装干员 <span class="text-delta">${esc(targetName)}</span> 身上；他人携带中的装备需先卸下或直接转移。`
        : '尚未上阵干员，装备只能查看与出售。上阵后可直接从仓库穿戴。'}
    </p>
    <div class="space-y-4">
      ${groups.map(({ slot, items }) => `
        <section>
          <h3 class="text-xs text-delta tracking-wider mb-2">
            ${slot.icon} ${esc(slot.name)} <span class="text-sand/35">(${items.length})</span>
          </h3>
          ${items.length ? `
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
              ${items.map((it) => `
                <div class="clip-tab bg-panel2 border ${it.equipped ? 'border-delta' : `bd-${it.rarity}`} px-3 py-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs rar-${it.rarity} truncate">${esc(it.name)}</span>
                    <span class="text-[11px] text-delta shrink-0">+${fmt(it.value)}</span>
                  </div>
                  <div class="grid grid-cols-3 gap-1 mt-1 text-[10px]">
                    <span class="text-sand/45">攻 <span class="text-rust">${fmt(it.atk)}</span></span>
                    <span class="text-sand/45">生 <span class="text-delta">${fmt(it.hp)}</span></span>
                    <span class="text-sand/45">防 <span class="text-sky-400">${fmt(it.def)}</span></span>
                  </div>
                  <div class="flex gap-2 mt-2">
                    ${it.equipped
                      ? `<span class="flex-1 text-center text-[10px] text-delta py-1 truncate">${esc(nameOf(it.holder))} 携带中</span>
                         ${target && it.holder !== target ? `<button data-action="eq-equip-uid" data-uid="${it.uid}" class="btn clip-tab text-[10px] py-1 px-2 border border-delta/40 text-delta hover:bg-delta/15">转给${esc(targetName)}</button>` : ''}`
                      : `<button data-action="eq-equip-uid" data-uid="${it.uid}" ${target ? '' : 'disabled'} class="btn flex-1 clip-tab text-[10px] py-1 border border-delta/50 text-delta hover:bg-delta/15">装备</button>
                         <button data-action="wh-sell-eq" data-uid="${it.uid}" class="btn clip-tab text-[10px] py-1 px-2 border border-rust/40 text-rust hover:bg-rust/15">出售</button>`}
                  </div>
                </div>
              `).join('')}
            </div>
          ` : `<p class="text-[11px] text-sand/35 py-2">暂无</p>`}
        </section>
      `).join('')}
    </div>
  `;
}

/* ============ 收藏品分类 ============ */

function renderCollectCat(s) {
  const list = warehouseCollectibles(s);
  if (!list.length) {
    return emptyState('尚未获得任何收藏品。收藏品来自战区的高价值遗物，撤离成功后入库', '🏺');
  }

  return `
    <p class="text-[11px] text-sand/50 mb-3 leading-relaxed">
      收藏品不提供战斗属性，只有出售价值。<span class="text-amber-400">传说级（大红）</span>收藏品获得后会自动登记进「收藏室」图鉴，出售也不会消除记录。
    </p>
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2">
      ${list.map((it) => `
        <article class="clip-tab bg-panel2 border bd-${it.rarity} px-3 py-2.5 ${it.isLegend ? 'wh-legend' : ''}">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs rar-${it.rarity} truncate">${esc(it.kindIcon)} ${esc(it.name)}</span>
            <span class="text-[11px] text-sand/60 shrink-0">×${it.count}</span>
          </div>
          <p class="text-[10px] text-sand/40 mt-0.5">${esc(it.rarityName)} · ${esc(it.kindName)}</p>
          <p class="text-[10px] text-sand/45 mt-1.5 leading-snug line-clamp-2">${esc(it.desc)}</p>
          <div class="flex items-center justify-between gap-2 mt-2">
            <span class="text-[10px] text-delta">总价值 ${fmt(it.total)}</span>
            <span class="text-[10px] text-sand/35">单件 ${fmt(it.value)}</span>
          </div>
          <div class="flex gap-2 mt-2">
            <button data-action="wh-col-detail" data-id="${it.id}"
              class="btn flex-1 clip-tab text-[10px] py-1 border border-line text-sand/60 hover:text-sand">详情</button>
            <button data-action="wh-sell-col" data-id="${it.id}"
              class="btn clip-tab text-[10px] py-1 px-2 border border-rust/40 text-rust hover:bg-rust/15">出售 1 件</button>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

/* ============ 材料分类 ============ */

function renderMaterialCat(s) {
  const list = warehouseMaterials(s);
  if (!list.length) {
    return emptyState('仓库内没有材料，可在「装备配置 · 商店」采购或从战区搜集', '🧪');
  }

  return `
    <p class="text-[11px] text-sand/50 mb-3 leading-relaxed">
      材料不计入战备，仅作为搜集与出售的物资。后续制造系统会消耗这些材料。
    </p>
    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-2">
      ${list.map((it) => `
        <div class="clip-tab bg-panel2 border bd-${it.rarity} px-3 py-2">
          <p class="text-xs rar-${it.rarity} truncate">${esc(it.name)}</p>
          <p class="text-[10px] text-sand/45 mt-0.5">${esc(it.rarityName)} · ×${it.count}</p>
          <p class="text-[10px] text-delta mt-0.5">总价值 ${fmt(it.total)}</p>
          <button data-action="wh-sell-mat" data-id="${it.id}"
            class="btn w-full clip-tab text-[10px] py-1 mt-2 border border-rust/40 text-rust hover:bg-rust/15">出售 1 个</button>
        </div>
      `).join('')}
    </div>
  `;
}

/* ============ 交互 ============ */

export function handleWarehouseCat(id) {
  setWarehouseCat(id);
  notify();
}

export async function handleWarehouseSellEquipment(uidStr) {
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

export async function handleSellCollectible(id) {
  const ok = await confirmDialog({
    title: '出售收藏品',
    body: '出售后按价值全额折算为哈夫币。收藏室的图鉴记录会保留。是否继续？',
    okText: '确认出售',
    danger: true
  });
  if (!ok) return;
  const r = sellCollectible(id, 1);
  toast(r.msg, r.ok ? 'ok' : 'err');
}

export async function handleSellMaterial(id) {
  const ok = await confirmDialog({
    title: '出售材料',
    body: '出售后按价值全额折算为哈夫币。是否继续？',
    okText: '确认出售',
    danger: true
  });
  if (!ok) return;
  const r = sellMaterial(id, 1);
  toast(r.msg, r.ok ? 'ok' : 'err');
}

export async function handleWarehouseSellAmmo(ammoId) {
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

export function handleCollectibleDetail(id) {
  const s = getState();
  const it = warehouseCollectibles(s).find((x) => x.id === id);
  if (!it) {
    toast('仓库中没有该收藏品', 'err');
    return;
  }
  openPanel({
    title: `${it.name} · 收藏品档案`,
    bodyHtml: `
      <div class="op-body">
        <div class="clip-tab bg-panel2 border bd-${it.rarity} px-4 py-4 text-center ${it.isLegend ? 'wh-legend' : ''}">
          <p class="text-4xl">${esc(it.kindIcon)}</p>
          <p class="text-sm rar-${it.rarity} mt-2">${esc(it.name)}</p>
          <p class="text-[10px] text-sand/45 mt-1">${esc(it.rarityName)} · ${esc(it.kindName)} · 持有 ×${it.count}</p>
        </div>
        <p class="op-desc mt-3">${esc(it.desc)}</p>
        <div class="grid grid-cols-2 gap-2 mt-3">
          ${statCard({ label: '单件价值', value: fmt(it.value), tone: 'delta' })}
          ${statCard({ label: '持有总价值', value: fmt(it.total), tone: 'amber' })}
        </div>
        <p class="text-[10px] text-sand/40 mt-3 leading-relaxed">
                ${it.rarity === RARITY.RED
            ? '该条目属于传说级（大红），已登记在收藏室图鉴中。'
            : '非传说级收藏品不进入收藏室图鉴，主要用于出售换取哈夫币。'}
        </p>
      </div>
    `
  });
}

/** 供外部按需绑定（当前统一在 prepare/index.js 的委托表中处理） */
export function bindWarehouse(root) {
  delegate(root, {
    'wh-cat': ({ cat: c }) => handleWarehouseCat(c)
  });
}

export { SLOTS as WAREHOUSE_SLOTS };
