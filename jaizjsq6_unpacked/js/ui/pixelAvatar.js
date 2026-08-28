/**
 * 干员像素头像
 *
 * 素材接入说明：
 * 目前图像素材未到位，这里用程序化像素小人做占位（每格 1 个像素点，按 12x12 网格绘制）。
 * 素材到位后，只需在 config/operators.js 的干员条目上补 avatar 字段（图片 URL），
 * 本模块会优先渲染该图片，无需改动任何调用方。
 */

import { esc } from '../core/utils.js';

/** 像素小人图案：每个字符对应一个色键，空格为透明 */
const PIXEL_ROWS = [
  '....hhhh....',
  '...hhhhhh...',
  '..hhhhhhhh..',
  '..hssssssh..',
  '..hseseses..',
  '..hssssssh..',
  '...ssmmss...',
  '..gggggggg..',
  '.ggguuuuggg.',
  '.gguuuuuugg.',
  '.gg.uuuu.gg.',
  '....uu.uu...'
];

const DEFAULT_PALETTE = { hair: '#3a3128', suit: '#4a5240', skin: '#c39a72', gear: '#2a2e26' };

/** 颜色键 → 实际取色 */
function colorOf(key, p) {
  switch (key) {
    case 'h': return p.hair;
    case 's': return p.skin;
    case 'e': return '#1b1e18';          // 眼睛
    case 'm': return shade(p.skin, -26);  // 嘴部阴影
    case 'g': return p.gear;              // 护具肩线
    case 'u': return p.suit;              // 战术服
    default: return null;
  }
}

function shade(hex, delta) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#000000';
  const n = parseInt(m[1], 16);
  const cl = (v) => Math.max(0, Math.min(255, v + delta));
  const r = cl((n >> 16) & 255);
  const g = cl((n >> 8) & 255);
  const b = cl(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * 生成像素小人（内联 SVG，随卡片尺寸自适应缩放）
 * @param {object} palette 干员配色
 * @param {boolean} dim 是否为未放出的置灰态
 */
export function pixelAvatar(palette, dim = false) {
  const p = { ...DEFAULT_PALETTE, ...(palette || {}) };
  const size = PIXEL_ROWS.length;
  let rects = '';

  PIXEL_ROWS.forEach((row, y) => {
    row.split('').forEach((key, x) => {
      const fill = colorOf(key, p);
      if (!fill) return;
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${dim ? shade(fill, -60) : fill}"/>`;
    });
  });

  return `
    <svg viewBox="0 0 ${size} ${size}" class="pixel-avatar" shape-rendering="crispEdges" aria-hidden="true">
      ${rects}
    </svg>
  `;
}

/**
 * 头像区域：优先使用真实图片素材，缺省回落到像素占位
 * @param {{avatar?:string, palette?:object, name?:string}} op
 */
export function avatarArt(op, dim = false) {
  if (op && op.avatar) {
    return `<img src="${esc(op.avatar)}" alt="${esc(op.name || '')}" class="pixel-avatar object-cover" loading="lazy">`;
  }
  return pixelAvatar(op?.palette, dim);
}
