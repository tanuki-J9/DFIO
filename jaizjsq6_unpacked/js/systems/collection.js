/**
 * 仓库与收藏室系统（壳子阶段）
 *
 * 职责：
 *  - 仓库分类视图：装备 / 收藏品 / 材料的统一聚合与价值统计
 *  - 收藏品的获得与出售
 *  - 收藏室图鉴登记：凡获得过的条目永久留档，即使物品已出售
 *
 * 说明：掉落接入（战利品产出收藏品）与图鉴收录奖励留待后续，本文件先提供完整可用接口。
 */

import {
  SLOTS, RARITY, RARITY_META, getTemplate, getMaterial, MATERIAL_TEMPLATES,
  COLLECTIBLE_TEMPLATES, COLLECT_KIND_META, getCollectible,
  GALLERY_SERIES, galleryTotal
} from '../config/index.js';
import { getState, notify } from '../core/state.js';
import { nonNegInt, num } from '../core/utils.js';
import { allEquippedUids, holderOf } from './equipment.js';

/* ============ 收藏室图鉴 ============ */

/**
 * 登记一条图鉴记录
 * @param {string} entryId 收藏品或装备模板 id
 */
export function recordGallery(entryId, s = getState()) {
  if (!entryId) return false;
  const known = GALLERY_SERIES.some((g) => g.entries.includes(entryId));
  if (!known) return false;
  const prev = s.gallery[entryId];
  if (prev) {
    prev.count = Math.max(1, nonNegInt(prev.count, 1)) + 1;
  } else {
    s.gallery[entryId] = { at: Date.now(), count: 1 };
  }
  return true;
}

/** 是否已收录 */
export function isDiscovered(entryId, s = getState()) {
  return !!s.gallery[entryId];
}

/** 图鉴收录进度 */
export function galleryProgress(s = getState()) {
  const total = galleryTotal();
  const owned = GALLERY_SERIES.reduce(
    (sum, g) => sum + g.entries.filter((id) => !!s.gallery[id]).length,
    0
  );
  return { owned, total, ratio: total ? owned / total : 0 };
}

/** 收藏室视图：按系列聚合条目 */
export function galleryView(s = getState()) {
  const series = GALLERY_SERIES.map((g) => {
    const entries = g.entries.map((id) => {
      const src = g.refType === 'equipment' ? getTemplate(id) : getCollectible(id);
      const rec = s.gallery[id] || null;
      const slotName = g.refType === 'equipment'
        ? (SLOTS.find((x) => x.id === src?.slot)?.name || '')
        : (COLLECT_KIND_META[src?.kind]?.name || '');
      return {
        id,
        refType: g.refType,
        name: src?.name || '未知条目',
        rarity: src?.rarity || RARITY.LEGEND,
        rarityName: RARITY_META[src?.rarity]?.name || '传说',
        value: num(src?.value, 0),
        desc: src?.desc || '',
        kindName: slotName,
        atk: num(src?.atk, 0),
        hp: num(src?.hp, 0),
        def: num(src?.def, 0),
        discovered: !!rec,
        at: rec ? rec.at : 0,
        count: rec ? Math.max(1, nonNegInt(rec.count, 1)) : 0
      };
    });
    const owned = entries.filter((e) => e.discovered).length;
    return { ...g, entries, owned, total: entries.length };
  });

  return { series, ...galleryProgress(s) };
}

/* ============ 收藏品 ============ */

/** 获得收藏品，同时登记图鉴 */
export function gainCollectible(id, count = 1, s = getState()) {
  const tpl = getCollectible(id);
  if (!tpl) return { ok: false, msg: '该收藏品不存在' };
  const n = Math.max(1, nonNegInt(count, 1));
  s.collectibles[id] = nonNegInt(s.collectibles[id], 0) + n;
  recordGallery(id, s);
  notify();
  return { ok: true, msg: `${tpl.name} ×${n} 已入库` };
}

/** 出售收藏品，按价值全额折算哈夫币（图鉴记录保留） */
export function sellCollectible(id, count = 1, s = getState()) {
  if (s.run) return { ok: false, msg: '行动进行中，无法操作仓库' };
  const tpl = getCollectible(id);
  if (!tpl) return { ok: false, msg: '该收藏品不存在' };
  const have = nonNegInt(s.collectibles[id], 0);
  if (have <= 0) return { ok: false, msg: '仓库中没有该收藏品' };
  const n = Math.min(have, Math.max(1, nonNegInt(count, 1)));
  const gain = Math.round(num(tpl.value, 0) * n);
  s.collectibles[id] = have - n;
  if (s.collectibles[id] <= 0) delete s.collectibles[id];
  s.currency.hafCoin = num(s.currency.hafCoin, 0) + gain;
  notify();
  return { ok: true, msg: `${tpl.name} ×${n} 已出售，获得 ${gain} 哈夫币` };
}

/* ============ 仓库分类视图 ============ */

/** 装备分类：按槽位分组 */
export function warehouseEquipment(s = getState()) {
  const equipped = allEquippedUids(s);
  return SLOTS.map((slot) => ({
    slot,
    items: s.inventory
      .filter((it) => it.slot === slot.id)
      .map((it) => {
        const tpl = getTemplate(it.tplId);
        if (!tpl) return null;
        return {
          uid: it.uid,
          tplId: it.tplId,
          name: tpl.name,
          rarity: tpl.rarity,
          rarityName: RARITY_META[tpl.rarity].name,
          value: num(tpl.value, 0),
          atk: num(tpl.atk, 0),
          hp: num(tpl.hp, 0),
          def: num(tpl.def, 0),
          equipped: equipped.has(it.uid),
          holder: equipped.has(it.uid) ? holderOf(it.uid, s) : null
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.value - a.value)
  }));
}

/** 收藏品分类：仅列出持有中的条目 */
export function warehouseCollectibles(s = getState()) {
  return COLLECTIBLE_TEMPLATES
    .map((tpl) => {
      const count = nonNegInt(s.collectibles[tpl.id], 0);
      if (count <= 0) return null;
      return {
        id: tpl.id,
        name: tpl.name,
        rarity: tpl.rarity,
        rarityName: RARITY_META[tpl.rarity].name,
        kindName: COLLECT_KIND_META[tpl.kind]?.name || '',
        kindIcon: COLLECT_KIND_META[tpl.kind]?.icon || '📦',
        desc: tpl.desc || '',
        value: num(tpl.value, 0),
        count,
        total: num(tpl.value, 0) * count,
        isLegend: tpl.rarity === RARITY.RED
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.total - a.total);
}

/** 材料分类 */
export function warehouseMaterials(s = getState()) {
  return MATERIAL_TEMPLATES
    .map((tpl) => {
      const count = nonNegInt(s.materials[tpl.id], 0);
      if (count <= 0) return null;
      return {
        id: tpl.id,
        name: tpl.name,
        rarity: tpl.rarity,
        rarityName: RARITY_META[tpl.rarity].name,
        value: num(tpl.value, 0),
        count,
        total: num(tpl.value, 0) * count
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.total - a.total);
}

/** 仓库总览统计 */
export function warehouseSummary(s = getState()) {
  const eqGroups = warehouseEquipment(s);
  const eqItems = eqGroups.flatMap((g) => g.items);
  const cols = warehouseCollectibles(s);
  const mats = warehouseMaterials(s);

  const eqValue = eqItems.reduce((sum, it) => sum + it.value, 0);
  const colValue = cols.reduce((sum, it) => sum + it.total, 0);
  const matValue = mats.reduce((sum, it) => sum + it.total, 0);

  return {
    equipment: { count: eqItems.length, value: eqValue, equipped: eqItems.filter((it) => it.equipped).length },
    collectible: { count: cols.reduce((n, it) => n + it.count, 0), value: colValue, kinds: cols.length },
    material: { count: mats.reduce((n, it) => n + it.count, 0), value: matValue, kinds: mats.length },
    totalValue: eqValue + colValue + matValue
  };
}

/** 材料出售（与收藏品同口径，按价值全额折算） */
export function sellMaterial(id, count = 1, s = getState()) {
  if (s.run) return { ok: false, msg: '行动进行中，无法操作仓库' };
  const tpl = getMaterial(id);
  if (!tpl) return { ok: false, msg: '该材料不存在' };
  const have = nonNegInt(s.materials[id], 0);
  if (have <= 0) return { ok: false, msg: '仓库中没有该材料' };
  const n = Math.min(have, Math.max(1, nonNegInt(count, 1)));
  const gain = Math.round(num(tpl.value, 0) * n);
  s.materials[id] = have - n;
  if (s.materials[id] <= 0) delete s.materials[id];
  s.currency.hafCoin = num(s.currency.hafCoin, 0) + gain;
  notify();
  return { ok: true, msg: `${tpl.name} ×${n} 已出售，获得 ${gain} 哈夫币` };
}
