// Лични настройки в браузъра (списък за наблюдение, избор за сравнение, тема).
// Всяко четене/запис е в try/catch: сайтът работи и когато localStorage е недостъпен.
const PREFIX = "bdc-radar.";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage blocked: keep working without persistence */
  }
}

export const MAX_COMPARE = 4;

export function watchlist() {
  return new Set(read("watchlist", []));
}

export function toggleWatch(ticker) {
  const list = watchlist();
  list.has(ticker) ? list.delete(ticker) : list.add(ticker);
  write("watchlist", [...list]);
  return list.has(ticker);
}

export function compareList() {
  return read("compare", []).slice(0, MAX_COMPARE);
}

export function setCompare(list) {
  write("compare", list.slice(0, MAX_COMPARE));
}

export function getPref(key, fallback) {
  return read(`pref.${key}`, fallback);
}

export function setPref(key, value) {
  write(`pref.${key}`, value);
}
