// Форматиране на числа и дати по български стандарт (запетая за десетични).
const DASH = "—";
const cache = new Map();

function nf(opts) {
  const key = JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat("bg-BG", opts));
  return cache.get(key);
}

const ok = (x) => x !== null && x !== undefined && Number.isFinite(x);

export function num(x, digits = 2) {
  return ok(x) ? nf({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x) : DASH;
}

export function int(x) {
  return ok(x) ? nf({ maximumFractionDigits: 0 }).format(x) : DASH;
}

export function pct(x, digits = 1) {
  return ok(x) ? `${num(x * 100, digits)}%` : DASH;
}

export function signedPct(x, digits = 1) {
  if (!ok(x)) return DASH;
  const s = num(Math.abs(x) * 100, digits);
  return `${x > 0 ? "+" : x < 0 ? "−" : ""}${s}%`;
}

export function money(x, digits = 2) {
  return ok(x) ? `$${num(x, digits)}` : DASH;
}

export function compactMoney(x) {
  if (!ok(x)) return DASH;
  const abs = Math.abs(x);
  if (abs >= 1e9) return `$${num(x / 1e9, 1)} млрд.`;
  if (abs >= 1e6) return `$${num(x / 1e6, 0)} млн.`;
  if (abs >= 1e3) return `$${num(x / 1e3, 0)} хил.`;
  return money(x, 0);
}

export function ratio(x, digits = 2) {
  return ok(x) ? `${num(x, digits)}x` : DASH;
}

export function date(s) {
  if (!s) return DASH;
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function quarterLabel(s) {
  if (!s) return DASH;
  const m = Number(s.slice(5, 7));
  return `Q${Math.ceil(m / 3)} ${s.slice(0, 4)}`;
}

export function deltaClass(x, goodWhenUp = true) {
  if (!ok(x) || x === 0) return "";
  return (x > 0) === goodWhenUp ? "delta-up" : "delta-down";
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export { DASH, ok };
