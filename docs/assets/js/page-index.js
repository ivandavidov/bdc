import { initLayout } from "./layout.js";
import * as data from "./data.js";
import * as f from "./format.js";
import * as store from "./store.js";
import * as charts from "./charts.js";
import { eventHtml } from "./events-ui.js";
import { METRICS, LIGHT_LABEL, VALUATION_LABEL, setScoring, statusHtml, valueWithDot } from "./metrics-def.js";

initLayout();

const COLUMNS = [
  { key: "p_nav", group: "base" },
  { key: "yield_fwd", group: "base" },
  { key: "coverage_ttm", group: "dividend" },
  { key: "cuts_5y", group: "dividend" },
  { key: "pik_pct_ttm", group: "dividend" },
  { key: "nav_chg_1y", group: "nav" },
  { key: "nav_tr_3y", group: "nav" },
  { key: "nonaccrual_fv", group: "credit" },
  { key: "fv_cost", group: "credit" },
  { key: "first_lien", group: "credit" },
  { key: "net_de", group: "leverage" },
  { key: "asset_coverage", group: "leverage" },
  { key: "opex_ratio", group: "costs" },
  { key: "managed", group: "costs", text: true },
  { key: "market_cap", group: "market" },
  { key: "tsr_1y", group: "market" },
  { key: "price", group: "market" },
];

const state = {
  rows: [],
  sort: store.getPref("sort", { key: "total", dir: -1 }),
  groups: new Set(store.getPref("groups", ["dividend", "nav", "credit", "leverage"])),
  lights: new Set(),
  onlyWatch: false,
  search: "",
  managed: "",
  size: "",
  watch: store.watchlist(),
  compare: store.compareList(),
};

const median = (xs) => {
  const v = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

function tiles(rows) {
  const counts = { green: 0, yellow: 0, red: 0 };
  let unrated = 0;
  rows.forEach((r) => (r.light ? counts[r.light]++ : unrated++));
  const tile = (label, value, sub = "") => `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  document.getElementById("tiles").innerHTML = [
    tile("Борсови BDC", f.int(rows.length), "NYSE и Nasdaq"),
    `<div class="tile"><div class="label">Светофар</div><div class="value" style="font-size:1.05rem;display:grid;gap:2px;margin-top:6px">
      ${["green", "yellow", "red"].map((l) => `<span class="status"><span class="dot ${l}"></span>${LIGHT_LABEL[l]}: <b>${counts[l]}</b></span>`).join("")}
      ${unrated ? `<span class="status muted small"><span class="dot"></span>Непълни данни: ${unrated}</span>` : ""}
    </div></div>`,
    tile("Медиана P/NAV", f.ratio(median(rows.map((r) => r.p_nav))), "цена спрямо NAV/акция"),
    tile("Медиана доходност", f.pct(median(rows.map((r) => r.yield_fwd))), "редовен дивидент ÷ цена"),
    tile("Медиана non-accruals", f.pct(median(rows.map((r) => r.nonaccrual_fv))), "% от портфейла (FV)"),
    tile("Медиана покритие", f.pct(median(rows.map((r) => r.coverage_ttm)), 0), "NII ÷ дивидент, 12 м"),
  ].join("");
}

function sizeOf(r) {
  if (!r.market_cap) return "";
  return r.market_cap >= 2e9 ? "large" : r.market_cap >= 5e8 ? "mid" : "small";
}

function filtered() {
  const q = state.search.trim().toLowerCase();
  return state.rows.filter((r) => {
    if (state.lights.size && !state.lights.has(r.light)) return false;
    if (state.onlyWatch && !state.watch.has(r.ticker)) return false;
    if (state.managed && r.managed !== state.managed) return false;
    if (state.size && sizeOf(r) !== state.size) return false;
    if (q && !`${r.ticker} ${r.name} ${r.manager ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function sorted(rows) {
  const { key, dir } = state.sort;
  // без светофар (непълни данни) отиват най-долу при сортиране по скор
  const val = (r) => (key === "total" && r.incomplete ? null : r[key]);
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === "string") return x.localeCompare(y, "bg") * dir;
    return (x - y) * dir;
  });
}

function visibleColumns() {
  return COLUMNS.filter((c) => c.group === "base" || state.groups.has(c.group));
}

function header(key, label, cls = "num") {
  const active = state.sort.key === key;
  const aria = active ? ` aria-sort="${state.sort.dir > 0 ? "ascending" : "descending"}"` : "";
  const help = METRICS[key]?.help ? ` title="${f.escapeHtml(METRICS[key].help)}"` : "";
  return `<th class="sortable ${cls}" data-sort="${key}"${aria}${help} scope="col">${label}</th>`;
}

function renderTable() {
  const rows = sorted(filtered());
  const cols = visibleColumns();
  document.getElementById("count").textContent = `${rows.length} от ${state.rows.length}`;
  const head = `<tr>
    <th scope="col"><span class="sr-only">Наблюдение</span></th>
    <th scope="col"><span class="sr-only">Сравнение</span></th>
    ${header("ticker", "BDC", "")}
    ${header("total", "Качество", "")}
    ${header("valuation", "Оценка", "")}
    ${cols.map((c) => header(c.key, METRICS[c.key].label, c.text ? "" : "num")).join("")}
  </tr>`;
  const body = rows.length
    ? rows.map((r) => {
        const watched = state.watch.has(r.ticker);
        const comparing = state.compare.includes(r.ticker);
        const flags = r.flags?.length ? ` <span class="badge" title="${r.flags.length} червени флага">⚑ ${r.flags.length}</span>` : "";
        return `<tr>
          <td><button class="star" data-watch="${r.ticker}" aria-pressed="${watched}" title="${watched ? "Махни от" : "Добави в"} моя списък" aria-label="Наблюдение ${r.ticker}">★</button></td>
          <td><input type="checkbox" class="compare-check" data-compare="${r.ticker}" ${comparing ? "checked" : ""} aria-label="Сравни ${r.ticker}"></td>
          <td class="ticker"><a href="company.html?t=${r.ticker}">${r.ticker}</a><span class="name" title="${f.escapeHtml(r.name)}">${f.escapeHtml(r.name)}</span></td>
          <td class="nowrap">${statusHtml(r.light, r.total)}${flags}</td>
          <td class="nowrap">${r.valuation ? VALUATION_LABEL[r.valuation] : f.DASH}</td>
          ${cols.map((c) => (c.text ? `<td class="nowrap">${METRICS[c.key].fmt(r[c.key])}</td>` : `<td class="num">${valueWithDot(c.key, r[c.key])}</td>`)).join("")}
        </tr>`;
      }).join("")
    : `<tr><td colspan="${cols.length + 5}" class="empty">Няма BDC, които отговарят на филтрите.</td></tr>`;
  document.getElementById("table-wrap").innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  renderCompareBar();
}

function renderCompareBar() {
  const bar = document.getElementById("compare-bar");
  bar.classList.toggle("visible", state.compare.length > 0);
  document.getElementById("compare-text").textContent =
    `Избрани за сравнение: ${state.compare.join(", ")} (${state.compare.length}/${store.MAX_COMPARE})`;
  document.getElementById("compare-go").href = `compare.html?t=${state.compare.join(",")}`;
}

function bindTable() {
  const wrap = document.getElementById("table-wrap");
  wrap.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (th) {
      const key = th.dataset.sort;
      state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: METRICS[key]?.dir === -1 || key === "ticker" ? 1 : -1 };
      store.setPref("sort", state.sort);
      renderTable();
      return;
    }
    const star = e.target.closest("[data-watch]");
    if (star) {
      const on = store.toggleWatch(star.dataset.watch);
      state.watch = store.watchlist();
      star.setAttribute("aria-pressed", on);
      if (state.onlyWatch) renderTable();
    }
  });
  wrap.addEventListener("change", (e) => {
    const box = e.target.closest("[data-compare]");
    if (!box) return;
    const t = box.dataset.compare;
    if (box.checked) {
      if (state.compare.length >= store.MAX_COMPARE) {
        box.checked = false;
        alert(`Може да сравнявате до ${store.MAX_COMPARE} компании едновременно.`);
        return;
      }
      state.compare.push(t);
    } else {
      state.compare = state.compare.filter((x) => x !== t);
    }
    store.setCompare(state.compare);
    renderCompareBar();
  });
  document.getElementById("compare-clear").addEventListener("click", () => {
    state.compare = [];
    store.setCompare([]);
    renderTable();
  });
}

function bindFilters() {
  document.getElementById("search").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderTable();
  });
  document.querySelectorAll("[data-light]").forEach((b) => b.addEventListener("click", () => {
    const l = b.dataset.light;
    state.lights.has(l) ? state.lights.delete(l) : state.lights.add(l);
    b.setAttribute("aria-pressed", state.lights.has(l));
    renderTable();
  }));
  const watchBtn = document.getElementById("only-watch");
  watchBtn.addEventListener("click", () => {
    state.onlyWatch = !state.onlyWatch;
    watchBtn.setAttribute("aria-pressed", state.onlyWatch);
    renderTable();
  });
  document.getElementById("managed").addEventListener("change", (e) => {
    state.managed = e.target.value;
    renderTable();
  });
  document.getElementById("size").addEventListener("change", (e) => {
    state.size = e.target.value;
    renderTable();
  });
  document.querySelectorAll("[data-group]").forEach((b) => {
    b.setAttribute("aria-pressed", state.groups.has(b.dataset.group));
    b.addEventListener("click", () => {
      const g = b.dataset.group;
      state.groups.has(g) ? state.groups.delete(g) : state.groups.add(g);
      b.setAttribute("aria-pressed", state.groups.has(g));
      store.setPref("groups", [...state.groups]);
      renderTable();
    });
  });
}

function renderScatter(rows) {
  const groups = ["green", "yellow", "red"].map((light) => ({
    name: LIGHT_LABEL[light],
    color: (t) => ({ green: t.good, yellow: t.warn, red: t.bad })[light],
    points: rows.filter((r) => r.light === light && r.p_nav && r.total !== null).map((r) => ({ name: r.ticker, x: r.p_nav, y: r.total, row: r })),
  }));
  const el = document.getElementById("scatter");
  charts.scatter(el, groups, {
    xName: "P/NAV (цена ÷ NAV/акция)",
    yName: "Скор",
    yMin: 0,
    yMax: 100,
    xFmt: (v) => f.ratio(v, 1),
    yFmt: (v) => f.int(v),
    vLine: 1,
    vLineLabel: "NAV",
    tooltip: (p) => {
      const r = p.data.raw.row;
      return `<b>${r.ticker}</b> · ${f.escapeHtml(r.name)}<br>Скор: <b>${f.num(r.total, 0)}</b> (${LIGHT_LABEL[r.light]})<br>P/NAV: <b>${f.ratio(r.p_nav)}</b><br>Доходност: ${f.pct(r.yield_fwd)}`;
    },
  });
  echarts.getInstanceByDom(el)?.on("click", (p) => p.data?.name && (location.href = `company.html?t=${p.data.name}`));
  charts.dataTable(el.parentElement, ["BDC", "Скор", "P/NAV"], rows.filter((r) => r.total !== null).map((r) => [r.ticker, f.num(r.total, 0), f.ratio(r.p_nav)]));
}

async function renderEvents() {
  const list = (await data.events()).slice(0, 10);
  const el = document.getElementById("events");
  if (!list.length) {
    el.innerHTML = `<p class="muted">Още няма записани промени. Дневникът се попълва при всяко обновяване на данните.</p>`;
    return;
  }
  el.innerHTML = list.map((e) => eventHtml(e)).join("");
}

async function main() {
  try {
    const [sum, meta] = await Promise.all([data.summary(), data.meta()]);
    setScoring(meta.scoring);
    state.rows = sum.companies.map((r) => ({ ...r, total: r.total ?? null }));
    document.getElementById("stamp").textContent = `Обновено: ${f.date(meta.generated)}`;
    tiles(state.rows);
    bindFilters();
    bindTable();
    renderTable();
    renderScatter(state.rows);
    renderEvents();
  } catch (err) {
    document.getElementById("tiles").innerHTML = `<div class="card">Данните не можаха да се заредят (${f.escapeHtml(err.message)}). Пуснете <code>python -m pipeline.build</code>.</div>`;
  }
}

main();
