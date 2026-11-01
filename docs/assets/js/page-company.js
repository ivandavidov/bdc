import { initLayout } from "./layout.js";
import * as data from "./data.js";
import * as f from "./format.js";
import * as store from "./store.js";
import * as charts from "./charts.js";
import { eventHtml } from "./events-ui.js";
import {
  METRICS, LIGHT_LABEL, VALUATION_LABEL, MANAGED_LABEL, CATEGORY_ORDER,
  setScoring, statusHtml, valueWithDot, lightFor,
} from "./metrics-def.js";

initLayout();

const app = document.getElementById("app");
const calQuarter = (d) => `${d.slice(0, 4)}Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`;

function section(id, title, body, note = "") {
  return `<section id="${id}"><div class="card"><div class="card-head"><h2>${title}</h2>${note}</div>${body}</div></section>`;
}

function chartCard(id, title, desc, cls = "chart") {
  return `<div class="card"><div class="card-head"><h3>${title}</h3></div>${desc ? `<p class="secondary small">${desc}</p>` : ""}<div class="${cls}" id="${id}"></div></div>`;
}

function headerHtml(c, meta) {
  const s = c.latest;
  const watched = store.watchlist().has(c.ticker);
  const managed = s.managed ? `<span class="badge${s.managed === "internal" ? " accent" : ""}">${MANAGED_LABEL[s.managed]} управление</span>` : "";
  const stale = c.price_stale ? `<span class="badge" title="Последното теглене на цени е неуспешно; показана е последната налична цена">цената може да е остаряла</span>` : "";
  return `<div class="company-head">
    <div>
      <h1>${f.escapeHtml(c.name)} <span class="ticker">${c.ticker}</span>
        <button class="star" id="watch" aria-pressed="${watched}" title="Моят списък" aria-label="Добави в моя списък">★</button></h1>
      <div class="meta-line">
        <span>${c.exchange ?? ""}</span>
        ${c.manager && s.managed !== "internal" ? `<span>Управляващо дружество: ${f.escapeHtml(c.manager)}</span>` : ""}
        ${managed}
        <span>Последен отчет: ${f.quarterLabel(s.nav_date)} (${f.date(s.nav_date)})</span>
        <a href="${c.edgar_url}" target="_blank" rel="noopener">Отчети в SEC EDGAR ↗</a>
        ${stale}
      </div>
    </div>
    <div class="toolbar" style="margin:0">
      <button class="btn" id="add-compare" type="button">+ Добави за сравнение</button>
    </div>
  </div>
  <div class="tiles" style="margin-top:16px">
    <div class="tile"><div class="label">Цена</div><div class="value">${f.money(s.price)}</div><div class="sub">към ${f.date(s.price_date)}</div></div>
    <div class="tile"><div class="label">NAV/акция</div><div class="value">${f.money(s.nav_ps)}</div><div class="sub">${f.date(s.nav_date)}</div></div>
    <div class="tile"><div class="label">P/NAV</div><div class="value">${f.ratio(s.p_nav)}</div><div class="sub">${s.p_nav_avg_3y ? `средно 3 г.: ${f.ratio(s.p_nav_avg_3y)}` : ""}${c.score.valuation ? ` · ${VALUATION_LABEL[c.score.valuation]}` : ""}</div></div>
    <div class="tile"><div class="label">Доходност</div><div class="value">${s.div_suspended ? "спрян" : f.pct(s.yield_fwd)}</div><div class="sub">${s.div_run_rate ? `${f.money(s.div_run_rate)} годишно` : ""}${s.div_freq === 12 ? " · месечно" : s.div_freq === 4 ? " · тримесечно" : ""}</div></div>
    <div class="tile"><div class="label">Пазарна капитализация</div><div class="value">${f.compactMoney(s.market_cap)}</div><div class="sub">оборот ${f.compactMoney(s.avg_dollar_volume)}/ден</div></div>
  </div>`;
}

function scoreHtml(c, meta) {
  const sc = c.score;
  const cats = meta.scoring.categories;
  const rows = CATEGORY_ORDER.map((k) => {
    const v = sc.categories[k];
    const light = lightFor(v);
    return `<div class="row"><span>${cats[k].label} <span class="muted small">(${cats[k].weight}%)</span></span>
      <div class="track" role="img" aria-label="${cats[k].label}: ${v === null ? "няма данни" : f.num(v, 0)}"><div class="fill ${light ?? "none"}" style="width:${v ?? 0}%"></div></div>
      <span class="num">${v === null ? f.DASH : f.num(v, 0)}</span></div>`;
  }).join("");
  const flags = sc.flags.length
    ? sc.flags.map((k) => `<div class="flag">${f.escapeHtml(meta.scoring.flags[k])}</div>`).join("")
    : `<p class="secondary small">Няма предупреждения.</p>`;
  return `<div class="grid grid-2">
    <div>
      <div class="tile hero" style="border:0;padding:0">
        <div class="label">Оценка за качество</div>
        <div class="value">${sc.total === null ? f.DASH : f.num(sc.total, 0)}<span class="muted" style="font-size:1rem"> / 100</span></div>
        <div style="margin-top:6px">${statusHtml(sc.light)}</div>
      </div>
      ${sc.incomplete ? `<p class="small secondary" style="margin-top:8px">Налични са само ${f.pct(sc.coverage, 0)} от теглото на оценката, затова светофар не се дава. Числото е ориентировъчно.</p>` : ""}
      ${sc.weak?.length ? `<div class="flag">Светофарът е червен, защото „${sc.weak.map((k) => cats[k].label).join("“, „")}“ е под ${meta.scoring.critical.floor} точки. Силните други категории не могат да компенсират това.</div>` : ""}
      <h3 style="margin-top:16px">Предупреждения</h3>${flags}
    </div>
    <div><div class="breakdown">${rows}</div>
      <p class="small muted" style="margin-top:10px">Ленти по категории (0–100). <a href="methodology.html">Методология</a></p></div>
  </div>`;
}

function metricsHtml(c, meta) {
  const s = c.latest;
  const pct = c.percentiles ?? {};
  const groups = [
    ["Дивидент", ["coverage_ttm", "coverage_q", "yield_ttm", "cuts_5y", "div_change_1y", "pik_pct_ttm"]],
    ["NAV и резултатност", ["nav_tr_1y", "nav_tr_3y", "nav_tr_5y", "nav_chg_1y", "nav_chg_3y", "nav_cagr_long", "nii_roe_ttm"]],
    ["Кредитно качество", ["nonaccrual_cost", "nonaccrual_fv", "fv_cost", "first_lien", "top10", "n_companies"]],
    ["Задлъжнялост и разходи", ["de", "net_de", "asset_coverage", "opex_ratio", "tsr_1y", "tsr_3y"]],
  ];
  return `<div class="grid grid-2">${groups.map(([title, keys]) => `<div><h3>${title}</h3>
    <table class="compact kv"><tbody>${keys.map((k) => {
      const p = pct[k];
      const approx = k === "de" && s.de_approx ? ` <span class="badge" title="Дългът не е отделно маркиран в XBRL; използвани са общите задължения">прибл.</span>` : "";
      const yrs = k === "nav_cagr_long" && s.nav_long_years ? ` <span class="muted small">(${f.num(s.nav_long_years, 0)} г.)</span>` : "";
      return `<tr><td title="${f.escapeHtml(METRICS[k].help)}">${METRICS[k].label}${yrs}${approx}</td><td class="num">${valueWithDot(k, s[k])}</td>
        <td class="pct muted small" title="Персентил спрямо всички борсови BDC (по-високо = по-добре)">${p === undefined ? "" : `по-добре от ${p}%`}</td></tr>`;
    }).join("")}</tbody></table></div>`).join("")}</div>`;
}

function rangeFilter(points, years) {
  if (!years) return points;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  const iso = cutoff.toISOString().slice(0, 10);
  return points.filter((p) => p[0] >= iso);
}

function priceChart(c, years) {
  const w = c.weekly;
  const price = rangeFilter(w.dates.map((d, i) => [d, w.close[i]]), years);
  const nav = rangeFilter(w.dates.map((d, i) => [d, w.nav[i]]).filter((p) => p[1] !== null), years);
  const el = document.getElementById("ch-price");
  charts.clearCharts(el.parentElement);
  charts.line(el, [
    { name: "Цена", data: price },
    { name: "NAV/акция", data: nav, step: true },
  ], { yFmt: (v) => f.money(v) });
}

function renderCharts(c, sector) {
  const qs = c.quarters;
  const labels = qs.map(f.quarterLabel);
  const q = c.q;
  const sectorIdx = new Map(sector.quarters.map((k, i) => [k, i]));
  const sectorSeries = (name) => qs.map((d) => {
    const i = sectorIdx.get(calQuarter(d));
    return i === undefined ? null : sector.median[name][i];
  });

  // Цена и NAV
  let years = 5;
  priceChart(c, years);
  document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => {
    years = Number(b.dataset.range);
    document.querySelectorAll("[data-range]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    priceChart(c, years);
  }));

  // P/NAV
  const w = c.weekly;
  const pn = w.dates.map((d, i) => [d, w.p_nav[i]]).filter((p) => p[1] !== null);
  const sec = sector.p_nav.dates.map((d, i) => [d, sector.p_nav.median[i]]).filter((p) => p[0] >= (pn[0]?.[0] ?? ""));
  charts.line(document.getElementById("ch-pnav"), [
    { name: c.ticker, data: pn },
    { name: "Медиана на сектора", data: sec },
  ], { yFmt: (v) => f.ratio(v), refLines: [{ y: 1, label: "= NAV" }] });

  // NII срещу дивидент
  const last = (arr, n = 20) => arr.slice(-n);
  const L = last(labels);
  charts.bars(document.getElementById("ch-nii"), [
    { name: "NII/акция", data: last(q.nii_ps) },
    { name: "Редовен дивидент/акция", data: last(q.reg_div), type: "line", step: true },
  ], { categories: L, yFmt: (v) => f.money(v) });
  charts.dataTable(document.getElementById("ch-nii").parentElement, ["Тримесечие", "NII/акция", "Редовен дивидент", "Покритие", "Обявени разпределения"],
    qs.map((d, i) => [f.quarterLabel(d), f.money(q.nii_ps[i]), f.money(q.reg_div[i]), f.pct(q.coverage[i], 0), f.money(q.dist_ps[i])]).reverse());

  charts.bars(document.getElementById("ch-cov"), [{ name: "Покритие", data: last(q.coverage) }],
    { categories: L, yFmt: (v) => f.pct(v, 0), refLines: [{ y: 1, label: "100%" }] });

  charts.bars(document.getElementById("ch-econ"), [
    { name: "Доходност на NAV", data: last(q.econ_return) },
    { name: "Медиана на сектора", data: last(sectorSeries("econ_return")), type: "line" },
  ], { categories: L, yFmt: (v) => f.pct(v, 1), colorBySign: true });
  charts.dataTable(document.getElementById("ch-econ").parentElement, ["Тримесечие", "NAV/акция", "Доходност на NAV", "Медиана на сектора"],
    qs.map((d, i) => [f.quarterLabel(d), f.money(q.nav_ps[i]), f.signedPct(q.econ_return[i]), f.signedPct(sectorSeries("econ_return")[i])]).reverse());

  // Необслужвани заеми
  const naIdx = qs.map((d, i) => i).filter((i) => q.nonaccrual_fv?.[i] !== null && q.nonaccrual_fv?.[i] !== undefined);
  const naEl = document.getElementById("ch-na");
  if (naIdx.length) {
    charts.line(naEl, [
      { name: "по справедлива стойност", data: naIdx.map((i) => q.nonaccrual_fv[i]) },
      { name: "по цена на придобиване", data: naIdx.map((i) => q.nonaccrual_cost[i]) },
      { name: "Медиана на сектора (цена)", data: naIdx.map((i) => sectorSeries("nonaccrual_cost")[i]) },
    ], { time: false, categories: naIdx.map((i) => labels[i]), yFmt: (v) => f.pct(v, 1), yMin: 0 });
  } else {
    naEl.outerHTML = `<p class="empty">Необслужвани заеми не са открити в XBRL данните на отчетите.</p>`;
  }

  charts.line(document.getElementById("ch-lev"), [
    { name: "D/E", data: last(q.de) },
    { name: "Медиана на сектора", data: last(sectorSeries("de")) },
  ], { time: false, categories: L, yFmt: (v) => f.ratio(v) });

  charts.line(document.getElementById("ch-pik"), [
    { name: "PIK дял", data: last(q.pik_pct) },
    { name: "Медиана на сектора", data: last(sectorSeries("pik_pct")) },
  ], { time: false, categories: L, yFmt: (v) => f.pct(v, 0), yMin: 0 });
}

function naTable(p) {
  return p.nonaccrual_names?.length
    ? `<div class="table-wrap"><table class="compact"><thead><tr><th>Необслужван кредитополучател</th><th class="num" title="Справедлива стойност">Спр. ст.</th><th class="num" title="Цена на придобиване">Цена</th></tr></thead>
       <tbody>${p.nonaccrual_names.slice(0, 10).map((r) => `<tr><td>${f.escapeHtml(r.name)}</td><td class="num">${f.compactMoney(r.fv)}</td><td class="num">${f.compactMoney(r.cost)}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="muted small">Няма поименно открити необслужвани заеми (данните може да са само обобщени).</p>`;
}

function portfolioHtml(c) {
  const p = c.portfolio;
  if (!p) return `<p class="muted">Детайлите на портфейла (Schedule of Investments) не са налични в XBRL за последния отчет.</p>`;
  const unspecified = p.industries.find(([n]) => n === "Неуточнен")?.[1] ?? 0;
  if (!p.reliable) {
    return `<div class="flag" style="background:var(--surface-2);border-color:var(--border)">Позициите, извлечени от XBRL, не съвпадат с баланса
      (сборът им е ${f.pct(p.coverage, 0)} от инвестициите в баланса), вероятно заради дублирани или липсващи редове.
      Съставът на портфейла не се показва и не участва в оценката. Вижте Schedule of Investments в последния отчет.</div>
      <div><h3>Необслужвани заеми</h3>${naTable(p)}</div>`;
  }
  const covNote = p.coverage && p.coverage < 0.9
    ? `<p class="small secondary">Разпознатите позиции покриват ${f.pct(p.coverage, 0)} от портфейла по баланс; съставът е за тази част.</p>` : "";
  const typeNote = p.typed_share < 0.8
    ? `<p class="small secondary">За ${f.pct(1 - p.typed_share, 0)} от портфейла типът (залог, дълг, акции) не е маркиран в XBRL, затова делът „първи по ред залог“ не се изчислява.</p>` : "";
  const na = naTable(p);
  return `<p class="secondary small">Към ${f.date(p.period)} (${p.form}) · ${f.int(p.n_companies)} компании · ${f.int(p.n_investments)} позиции
    · плаваща лихва ${f.pct(p.floating, 0)} от дълга · средна лихва по дълга ${f.pct(p.debt_yield)}</p>${covNote}${typeNote}
    <div class="grid grid-2">
      <div><h3>По тип инвестиция</h3><div class="chart short" id="ch-types"></div></div>
      <div><h3>Отрасли</h3>${unspecified > 0.5 ? `<p class="muted small">Компанията не маркира отраслите в XBRL (${f.pct(unspecified, 0)} без отрасъл).</p>` : `<div class="chart short" id="ch-ind"></div>`}</div>
      <div><h3>10-те най-големи позиции</h3><div class="table-wrap"><table class="compact"><thead><tr><th>Компания</th><th class="num">% от портфейла</th></tr></thead>
        <tbody>${p.top10.map(([n, v]) => `<tr><td>${f.escapeHtml(n)}</td><td class="num">${f.pct(v, 1)}</td></tr>`).join("")}</tbody></table></div>
        <p class="small muted">Общо за 10-те най-големи: ${f.pct(p.top10_pct, 0)}</p></div>
      <div><h3>Необслужвани заеми</h3>${na}</div>
    </div>`;
}

function renderPortfolioCharts(c) {
  const p = c.portfolio;
  if (!p || !p.reliable) return;
  const types = Object.entries(p.by_type);
  charts.hbars(document.getElementById("ch-types"), types.map(([k]) => p.type_labels[k] ?? k), types.map(([, v]) => v), { labelWidth: 190 });
  const ind = document.getElementById("ch-ind");
  if (ind) {
    const rows = p.industries.filter(([n]) => n !== "Неуточнен").slice(0, 10);
    charts.hbars(ind, rows.map(([n]) => n), rows.map(([, v]) => v), { labelWidth: 170 });
  }
}

function dividendsHtml(c) {
  const rows = [...c.dividends].reverse().slice(0, 24);
  const freq = { 12: "месечен", 4: "тримесечен", 2: "полугодишен", 1: "годишен" };
  const cuts = c.cuts.length
    ? `<ul>${[...c.cuts].reverse().map((x) => `<li>${f.date(x.date)}: ${f.money(x.from)} → ${f.money(x.to)} годишно (${f.signedPct(x.change)})</li>`).join("")}</ul>`
    : `<p class="muted small">Няма засечени съкращения за последните 10 години.</p>`;
  return `<div class="grid grid-2">
    <div><h3>Последни плащания (по дата без право на дивидент)</h3>
      <div class="table-wrap" style="max-height:360px"><table class="compact"><thead><tr><th title="Дата без право на дивидент (ex-date)">Дата</th><th class="num">Сума</th><th>Вид</th></tr></thead>
      <tbody>${rows.map((d) => `<tr><td>${f.date(d.date)}</td><td class="num">${f.money(d.amount, 3)}</td>
        <td>${d.special > 0 && d.regular > 0 ? `редовен ${f.money(d.regular, 3)} + специален` : d.special > 0 ? "специален / допълнителен" : `редовен (${freq[d.freq] ?? ""})`}</td></tr>`).join("")}</tbody></table></div></div>
    <div><h3>Съкращения на дивидента</h3>${cuts}
      <p class="small muted">Редовните и специалните дивиденти се разделят автоматично по сумата и честотата на плащанията. При BDC с променлив допълнителен дивидент разделянето може да е неточно.</p></div>
  </div>`;
}

function costsHtml(c) {
  const s = c.latest;
  const q = c.q;
  const ttm = (arr) => {
    const v = arr.slice(-4);
    return v.length === 4 && v.every((x) => x !== null) ? v.reduce((a, b) => a + b, 0) : null;
  };
  return `<table class="compact kv"><tbody>
    <tr><td>Управление</td><td>${s.managed ? MANAGED_LABEL[s.managed] : f.DASH}${c.manager ? ` · ${f.escapeHtml(c.manager)}` : ""}</td></tr>
    <tr><td>Такса за управление (12 м.)</td><td class="num">${f.compactMoney(ttm(q.mgmt_fee))}</td></tr>
    <tr><td>Такса за постигнат резултат (12 м.)</td><td class="num">${f.compactMoney(ttm(q.incentive_fee))}</td></tr>
    <tr><td>${METRICS.opex_ratio.label} — без лихви, % от NAV</td><td class="num">${valueWithDot("opex_ratio", s.opex_ratio)}</td></tr>
    <tr><td>Общ коефициент на разходите (отчетен, вкл. лихви)</td><td class="num">${f.pct(s.expense_ratio_reported)}</td></tr>
  </tbody></table>`;
}

function holdersHtml(c) {
  const h = c.holders;
  if (!h) return `<p class="muted">Няма данни за акционерите.</p>`;
  const retail = h.institutions !== null && h.insiders !== null ? Math.max(0, 1 - h.institutions - h.insiders) : null;
  const table = (rows, title) => rows?.length
    ? `<h3>${title}</h3><div class="table-wrap"><table class="compact"><thead><tr><th>Акционер</th><th class="num">% от акциите</th>
        <th class="num">Стойност</th><th class="num" title="Промяна на броя акции спрямо предходния отчет">Промяна</th><th class="num">Към</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${f.escapeHtml(r.name)}</td><td class="num">${f.pct(r.pct, 2)}</td><td class="num">${f.compactMoney(r.value)}</td>
        <td class="num ${f.deltaClass(r.change)}">${r.change === null ? f.DASH : f.signedPct(r.change)}</td><td class="num">${f.date(r.date)}</td></tr>`).join("")}</tbody></table></div>`
    : "";
  return `<div class="tiles">
      <div class="tile"><div class="label">Вътрешни лица</div><div class="value">${f.pct(h.insiders, 1)}</div><div class="sub">ръководство, директори, управляващо дружество</div></div>
      <div class="tile"><div class="label">Институционални инвеститори</div><div class="value">${f.pct(h.institutions, 0)}</div><div class="sub">${h.institutions_count ? `брой: ${f.int(h.institutions_count)}` : ""}</div></div>
      <div class="tile"><div class="label">Индивидуални и други</div><div class="value">${f.pct(retail, 0)}</div><div class="sub">остатъкът (приблизително)</div></div>
    </div>
    <div class="stack" style="margin-top:16px">
      <div>${table(h.institutional, "Най-големи институционални акционери")}</div>
      <div>${table(h.funds, "Най-големи фондове (вкл. ETF)")}</div>
    </div>
    <p class="small muted" style="margin-top:8px">Източник: Yahoo Finance по отчети 13F, които се подават до 45 дни след края на тримесечието; данните закъсняват 1–3 месеца.
      Банките често държат акциите от името на клиенти. Пълен списък с акционери над 5%: отчети 13D/13G в <a href="${c.edgar_url}" target="_blank" rel="noopener">EDGAR ↗</a>.</p>`;
}

function filingsHtml(c) {
  return `<div class="table-wrap"><table class="compact"><thead><tr><th>Дата</th><th>Документ</th><th>Период</th></tr></thead><tbody>
    ${c.filings.map((x) => `<tr><td>${f.date(x.date)}</td><td><a href="${x.url}" target="_blank" rel="noopener">${x.form} ↗</a></td><td>${x.period ? f.date(x.period) : ""}</td></tr>`).join("")}
  </tbody></table></div>`;
}

async function main() {
  const ticker = (data.param("t") || "").toUpperCase();
  if (!ticker) {
    location.href = "index.html";
    return;
  }
  let c;
  let meta;
  let sector;
  try {
    [c, meta, sector] = await Promise.all([data.company(ticker), data.meta(), data.sector()]);
  } catch {
    app.innerHTML = `<div class="card"><h1>Няма данни за ${f.escapeHtml(ticker)}</h1><p><a href="index.html">Към таблото</a></p></div>`;
    return;
  }
  setScoring(meta.scoring);
  document.title = `${c.ticker} · ${c.name}`;

  app.innerHTML = `
    ${headerHtml(c, meta)}
    ${section("score", "Оценка", scoreHtml(c, meta))}
    ${section("metrics", "Ключови показатели", metricsHtml(c, meta), `<span class="small muted">Цветната точка показва точките на показателя по методологията</span>`)}
    <section class="grid grid-2">
      <div class="card"><div class="card-head"><h3>Цена и NAV/акция</h3>
        <div class="toolbar" style="margin:0">${[[1, "1 г."], [3, "3 г."], [5, "5 г."], [0, "Всичко"]].map(([y, l]) => `<button class="chip" data-range="${y}" aria-pressed="${y === 5}">${l}</button>`).join("")}</div></div>
        <p class="secondary small">Цената под NAV линията = отстъпка; над нея = премия.</p><div class="chart" id="ch-price"></div></div>
      ${chartCard("ch-pnav", "P/NAV във времето", "Под 1,0 = търгува се под нетната стойност на активите.")}
      ${chartCard("ch-nii", "Нетен инвестиционен доход срещу дивидент", "На акция, по тримесечия. Колона над линията = доходът покрива дивидента.")}
      ${chartCard("ch-cov", "Покритие на дивидента", "NII ÷ редовен дивидент. Под 100% дивидентът се плаща частично от капитала или от натрупан доход.")}
      ${chartCard("ch-econ", "Доходност на NAV (с дивидентите)", "(Промяна на NAV + разпределения) ÷ начален NAV за всяко тримесечие.")}
      ${chartCard("ch-na", "Необслужвани заеми", "Дял на заемите, по които не се начислява лихва.")}
      ${chartCard("ch-lev", "Задлъжнялост (D/E)", "(Дълг + привилегировани акции) ÷ нетни активи. Законовият таван е 2,0x, което отговаря на минимално покритие на дълга с активи 150%.")}
      ${chartCard("ch-pik", "PIK доход", "Дял на безкасовия доход (лихва, платена с нов дълг) в общия инвестиционен доход.")}
    </section>
    ${section("portfolio", "Портфейл", portfolioHtml(c))}
    ${section("dividends", "Дивиденти", dividendsHtml(c))}
    ${section("holders", "Акционери", holdersHtml(c))}
    <section class="grid grid-2">
      <div class="card"><h2>Такси и управление</h2>${costsHtml(c)}</div>
      <div class="card"><h2>Отчети в SEC</h2>${filingsHtml(c)}</div>
    </section>
    ${section("events", "Промени", c.events?.length ? c.events.map((e) => eventHtml(e, { showTicker: false })).join("") : `<p class="muted">Още няма записани промени за ${c.ticker}.</p>`)}
  `;

  renderCharts(c, sector);
  renderPortfolioCharts(c);

  document.getElementById("watch").addEventListener("click", (e) => {
    e.currentTarget.setAttribute("aria-pressed", store.toggleWatch(c.ticker));
  });
  const addBtn = document.getElementById("add-compare");
  const paint = () => {
    const inList = store.compareList().includes(c.ticker);
    addBtn.textContent = inList ? "✓ В сравнението" : "+ Добави за сравнение";
  };
  paint();
  addBtn.addEventListener("click", () => {
    const list = store.compareList();
    if (list.includes(c.ticker)) {
      location.href = `compare.html?t=${list.join(",")}`;
      return;
    }
    if (list.length >= store.MAX_COMPARE) list.shift();
    list.push(c.ticker);
    store.setCompare(list);
    location.href = `compare.html?t=${list.join(",")}`;
  });
}

main();
