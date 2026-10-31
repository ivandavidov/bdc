// Зареждане на генерираните JSON файлове от docs/data/.
const cache = new Map();

async function load(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(path, { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`${path}: ${r.status}`);
        return r.json();
      }),
    );
  }
  return cache.get(path);
}

export const summary = () => load("data/summary.json");
export const sector = () => load("data/sector.json");
export const meta = () => load("data/meta.json");
export const events = () => load("data/events.json").catch(() => []);
export const company = (ticker) => load(`data/companies/${encodeURIComponent(ticker)}.json`);

export function param(name) {
  return new URLSearchParams(location.search).get(name);
}
