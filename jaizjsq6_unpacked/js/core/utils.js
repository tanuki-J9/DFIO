/** 通用工具函数：数值校验、随机、格式化 */

/** 安全数字：非有限值回退默认值 */
export function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 非负整数 */
export function nonNegInt(v, fallback = 0) {
  const n = Math.floor(num(v, fallback));
  return n < 0 ? 0 : n;
}

/** 非负数 */
export function nonNeg(v, fallback = 0) {
  const n = num(v, fallback);
  return n < 0 ? 0 : n;
}

export function clamp(v, min, max) {
  const n = num(v, min);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function randInt(min, max) {
  const a = Math.ceil(num(min, 0));
  const b = Math.floor(num(max, a));
  if (b <= a) return a;
  return a + Math.floor(Math.random() * (b - a + 1));
}

export function randFloat(min, max) {
  const a = num(min, 0);
  const b = num(max, a);
  if (b <= a) return a;
  return a + Math.random() * (b - a);
}

export function pick(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 按权重表随机：weights 为 { key: weight } */
export function weightedPick(weights) {
  if (!weights || typeof weights !== 'object') return null;
  const entries = Object.entries(weights).filter(([, w]) => num(w, 0) > 0);
  if (!entries.length) return null;
  const total = entries.reduce((s, [, w]) => s + num(w, 0), 0);
  let roll = Math.random() * total;
  for (const [key, w] of entries) {
    roll -= num(w, 0);
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

let uidSeed = 0;
export function uid(prefix = 'id') {
  uidSeed += 1;
  return `${prefix}_${Date.now().toString(36)}_${uidSeed.toString(36)}`;
}

/** 数值格式化：大数转 K / M */
export function fmt(v) {
  const n = num(v, 0);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `${(n / 1000).toFixed(1)}K`;
  return Math.round(n).toLocaleString('zh-CN');
}

/** 秒 → mm:ss */
export function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(num(sec, 0)));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** 时间戳 → hh:mm:ss */
export function fmtClock(ts) {
  const d = new Date(num(ts, Date.now()));
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function pct(v, digits = 0) {
  return `${(num(v, 0) * 100).toFixed(digits)}%`;
}

/** HTML 转义，防止名称注入 */
export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** 深拷贝（仅处理纯数据） */
export function deepClone(obj) {
  try {
    return structuredClone(obj);
  } catch {
    return JSON.parse(JSON.stringify(obj));
  }
}

/** 简易防抖闸门：同 key 在 ms 内只允许一次 */
const gateMap = new Map();
export function gate(key, ms) {
  const now = Date.now();
  const last = gateMap.get(key) || 0;
  if (now - last < num(ms, 0)) return false;
  gateMap.set(key, now);
  return true;
}
