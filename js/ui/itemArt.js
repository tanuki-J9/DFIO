/**
 * 装备 / 弹药视觉组件。
 * 默认使用 CSS 像素占位图；配置 image 或 imageUrl 后自动优先显示外部图片。
 */

import { esc } from '../core/utils.js';

const KINDS = new Set(['weapon', 'armor', 'helmet', 'bag', 'tactical', 'ammo', 'equipment']);
const SIZES = new Set(['sm', 'md', 'lg']);
const RARITIES = new Set(['common', 'rare', 'epic', 'legend', 'red']);

export function itemArt(item = {}, options = {}) {
  const kindRaw = (item.slot && item.slot !== 'equipment' ? item.slot : null) || item.kind || 'equipment';
  const kind = KINDS.has(kindRaw) ? kindRaw : 'equipment';
  const size = SIZES.has(options.size) ? options.size : 'md';
  const rarity = RARITIES.has(item.rarity) ? item.rarity : 'common';
  const imageUrl = item.imageUrl || item.image || '';
  const name = item.name || '装备';
  const level = Math.max(0, Math.round(Number(item.level) || 0));
  const showLevel = options.showLevel !== false && level > 0;
  const imageClass = imageUrl ? ' has-image' : '';

  return `<span class="item-art item-art--${size} item-art--${kind} rar-bg-${rarity}${imageClass}" data-item-kind="${kind}" role="img" aria-label="${esc(name)}">
    ${imageUrl
      ? `<img class="item-art-image" src="${esc(imageUrl)}" alt="${esc(name)}" loading="lazy" decoding="async">`
      : '<span class="item-art-shape" aria-hidden="true"><span class="item-art-detail"></span></span>'}
    ${showLevel ? `<span class="item-art-level">${level}</span>` : ''}
  </span>`;
}

export function slotArt(slot, options = {}) {
  return itemArt({ slot: slot?.id, name: slot?.name || '装备槽' }, { showLevel: false, ...options });
}
