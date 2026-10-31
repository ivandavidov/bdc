import { initLayout } from "./layout.js";
import * as data from "./data.js";
import * as f from "./format.js";
import * as store from "./store.js";
import * as charts from "./charts.js";
import { METRICS, CATEGORY_ORDER, setScoring, statusHtml, valueWithDot, VALUATION_LABEL } from "./metrics-def.js";

initLayout();

const ROWS = [
  ["Оценка", ["total"]],
  ["Пазар", ["price", "p_nav", "p_nav_avg_3y", "yield_fwd", "yield_ttm", "market_cap", "tsr_1y", "tsr_3y"]],
  ["Дивидент", ["coverage_ttm", "coverage_q", "cuts_5y", "div_change_1y", "pik_pct_ttm"]],
  ["NAV", ["nav_ps", "nav_chg_1y", "nav_chg_3y", "nav_tr_1y", "nav_tr_3y", "nav_tr_5y"]],
  ["Кредит", ["nonaccrual_fv", "fv_cost", "first_lien", "top10", "n_companies", "floating"]],
  ["Ливъридж и разходи", ["de", "net_de", "asset_coverage", "opex_ratio", "managed"]],
];

let selected = [];
let summary;
let meta;

function syncUrl() {
  const url = new URL(location.href);
  if (selected.length) url.searchParams.set("t", selected.join(","));
  else url.searchParams.delete("t");
  history.replaceState(null, "", url);
  store.setCompare(selected);
}

function renderChosen() {
  document.getElementById("chosen").innerHTML = selected
    .map((t) => `<button class="chip" aria-pressed="true" data-remove="${t}" title="Премахни ${t}">${t} ✕</button>`)
    .join("");
}

function add(ticker) {
  const t = (ticker || "").trim().toUpperCase();
  if (!t || selected.includes(t) || !summary.companies.some((c) => c.ticker === t)) return;
  if (selected.length >= store.MAX_COMPARE) selected.shift();
  selected.push(t);
  refresh();
}

function best(key, values) {
  const dir = METRICS[key]?.dir ?? 0;
  if (!dir) return null;
  const valid = values.filter((v) => v !== null && v !== undefined);
  if (valid.length < 2) return null;
  return dir > 0 ? Math.max(...valid) : Math.min(...valid);
}

function tableHtml(companies) {
  const head = `<tr><th>Метрика</th>${companies.map((c) => `<th class="num"><a href="company.html?t=${c.ticker}">${c.ticker}</a></th>`).join("")}</tr>`;
  const body = ROWS.map(([group, keys]) => {
    const rows = keys.map((k) => {
      const values = companies.map((c) => (k === "total" ? c.score.total : c.latest[k]));
      const top = best(k, values);
      const cells = companies.map((c, i) => {
        if (k === "total") return `<td class="num">${statusHtml(c.score.light, c.score.total)}</td>`;
        if (k === "managed") return `<td class="num">${METRICS.managed.fmt(values[i])}</td>`;
        const mark = top !== null && values[i] === top ? ` <span class="badge accent" title="Най-добра стойност сред избраните">най-добро</span>` : "";
        return `<td class="num">${valueWithDot(k, values[i])}${mark}</td>`;
      }).join("");
      return `<tr><td title="${f.escapeHtml(METRICS[k].help)}">${METRICS[k].label}</td>${cells}</tr>`;
    }).join("");
    return `<tr><th colspan="${companies.length + 1}" style="background:var(--surface)">${group}</th></tr>${rows}`;
  }).join("");
  const cats = CATEGORY_ORDER.map((k) => `<tr><td>${meta.scoring.categories[k].label}</td>${companies.map((c) => `<td class="num">${f.num(c.score.categories[k], 0)}</td>`).join("")}</tr>`).join("");
  const val = `<tr><td>Оценка спрямо историята</td>${companies.map((c) => `<td class="num">${c.score.valuation ? VALUATION_LABEL[c.score.valuation] : f.DASH}</td>`).join("")}</tr>`;
  return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}
    <tr><th colspan="${companies.length + 1}" style="background:var(--surface)">Скор по категории</th></tr>${cats}${val}</tbody></table></div>`;
}

function quarterKey(d) {
  return `${d.slice(0, 4)}Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`;
}

function alignQuarterly(companies, key, n = 16) {
  const keys = [...new Set(companies.flatMap((c) => c.quarters.map(quarterKey)))].sort().slice(-n);
  return {
    categories: keys.map((k) => `${k.slice(5)} ${k.slice(0, 4)}`),
    series: companies.map((c) => {
      const map = new Map(c.quarters.map((d, i) => [quarterKey(d), c.q[key]?.[i] ?? null]));
      return { name: c.ticker, data: keys.map((k) => map.get(k) ?? null) };
    }),
  };
}

function renderCharts(companies) {
  // NAV/акция, индексиран към 100 в началото на общия период (различните цени не са сравними директно)
  const start = companies.map((c) => c.weekly.dates.find((d, i) => c.weekly.nav[i])).sort().pop();
  const navSeries = companies.map((c) => {
    const w = c.weekly;
    const base = w.nav[w.dates.findIndex((d, i) => d >= start && w.nav[i])];
    return {
      name: c.ticker,
      data: w.dates.map((d, i) => [d, w.nav[i] && d >= start ? (100 * w.nav[i]) / base : null]).filter((p) => p[1] !== null),
    };
  });
  charts.line(document.getElementById("cmp-nav"), navSeries, { yFmt: (v) => f.num(v, 0), legend: true });

  const pnav = companies.map((c) => ({
    name: c.ticker,
    data: c.weekly.dates.map((d, i) => [d, c.weekly.p_nav[i]]).filter((p) => p[1] !== null && p[0] >= start),
  }));
  charts.line(document.getElementById("cmp-pnav"), pnav, { yFmt: (v) => f.ratio(v), refLines: [{ y: 1, label: "= NAV" }], legend: true });

  const cov = alignQuarterly(companies, "coverage", 12);
  charts.line(document.getElementById("cmp-cov"), cov.series, { time: false, categories: cov.categories, yFmt: (v) => f.pct(v, 0), refLines: [{ y: 1, label: "100%" }], legend: true });

  const econ = alignQuarterly(companies, "econ_return", 12);
  charts.bars(document.getElementById("cmp-econ"), econ.series, { categories: econ.categories, yFmt: (v) => f.pct(v, 1) });

  const na = alignQuarterly(companies, "nonaccrual_fv", 8);
  charts.line(document.getElementById("cmp-na"), na.series, { time: false, categories: na.categories, yFmt: (v) => f.pct(v, 1), yMin: 0, legend: true });

  const de = alignQuarterly(companies, "de", 12);
  charts.line(document.getElementById("cmp-de"), de.series, { time: false, categories: de.categories, yFmt: (v) => f.ratio(v), legend: true });
}

async function refresh() {
  syncUrl();
  renderChosen();
  const content = document.getElementById("content");
  charts.clearCharts(content);
  if (!selected.length) {
    content.innerHTML = `<div class="card empty">Изберете поне една компания — от полето по-горе или с отметките в <a href="index.html">таблицата</a>.</div>`;
    return;
  }
  const companies = (await Promise.all(selected.map((t) => data.company(t).catch(() => null)))).filter(Boolean);
  content.innerHTML = `${tableHtml(companies)}
    <section class="grid grid-2">
      <div class="card"><h3>NAV/акция (индекс, начало = 100)</h3><p class="secondary small">Индексиран, защото абсолютните NAV/акция не са сравними между компании.</p><div class="chart" id="cmp-nav"></div></div>
      <div class="card"><h3>P/NAV</h3><div class="chart" id="cmp-pnav"></div></div>
      <div class="card"><h3>Покритие на дивидента</h3><div class="chart" id="cmp-cov"></div></div>
      <div class="card"><h3>Икономическа доходност по тримесечия</h3><div class="chart" id="cmp-econ"></div></div>
      <div class="card"><h3>Non-accruals (% FV)</h3><div class="chart" id="cmp-na"></div></div>
      <div class="card"><h3>Ливъридж (D/E)</h3><div class="chart" id="cmp-de"></div></div>
    </section>`;
  renderCharts(companies);
}

async function main() {
  [summary, meta] = await Promise.all([data.summary(), data.meta()]);
  setScoring(meta.scoring);
  document.getElementById("tickers").innerHTML = summary.companies
    .map((c) => `<option value="${c.ticker}">${f.escapeHtml(c.name)}</option>`).join("");
  const fromUrl = (data.param("t") || "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  selected = (fromUrl.length ? fromUrl : store.compareList()).filter((t) => summary.companies.some((c) => c.ticker === t)).slice(0, store.MAX_COMPARE);

  const picker = document.getElementById("picker");
  document.getElementById("add").addEventListener("click", () => {
    add(picker.value);
    picker.value = "";
  });
  picker.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      add(picker.value);
      picker.value = "";
    }
  });
  document.getElementById("chosen").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]");
    if (!b) return;
    selected = selected.filter((t) => t !== b.dataset.remove);
    refresh();
  });
  refresh();
}

main();
