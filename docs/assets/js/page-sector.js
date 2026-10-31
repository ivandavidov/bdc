import { initLayout } from "./layout.js";
import * as data from "./data.js";
import * as f from "./format.js";
import * as charts from "./charts.js";
import { CATEGORY_ORDER, LIGHT_LABEL, setScoring, statusHtml } from "./metrics-def.js";

initLayout();

const card = (id, title, desc, cls = "chart") =>
  `<div class="card"><h3>${title}</h3>${desc ? `<p class="secondary small">${desc}</p>` : ""}<div class="${cls}" id="${id}"></div></div>`;

async function main() {
  const [sector, summary, meta] = await Promise.all([data.sector(), data.summary(), data.meta()]);
  setScoring(meta.scoring);
  const rows = summary.companies.filter((r) => r.total !== null);
  const content = document.getElementById("content");
  const cats = meta.scoring.categories;

  content.innerHTML = `
    <section class="grid grid-2" style="margin-top:0">
      ${card("s-pnav", "Медиана P/NAV", "Седмично, за всички BDC с налична цена и NAV.")}
      ${card("s-econ", "Медиана на икономическата доходност", "По календарни тримесечия: (промяна на NAV + разпределения) ÷ начален NAV.")}
      ${card("s-cov", "Медиана на покритието на дивидента", "NII ÷ редовен дивидент.")}
      ${card("s-na", "Медиана на non-accruals", "% от портфейла по цена на придобиване. Историята е кратка: събира се от отчетите напред във времето.")}
      ${card("s-de", "Медиана на ливъриджа (D/E)", "")}
      ${card("s-pik", "Медиана на PIK дохода", "Дял на безкасовия доход в инвестиционния доход.")}
    </section>
    <section class="card">
      <div class="card-head"><h2>Класация по скор „Качество“</h2>
        <div class="legend">${["green", "yellow", "red"].map((l) => `<span><span class="dot ${l}"></span>${LIGHT_LABEL[l]}</span>`).join("")}</div></div>
      <div id="s-rank" style="height:${Math.max(300, rows.filter((r) => !r.incomplete).length * 22 + 20)}px"></div>
      <p class="small muted" id="s-unrated"></p>
    </section>
    <section>
      <h2>Най-силни по категория</h2>
      <div class="grid grid-3">${CATEGORY_ORDER.map((k) => {
        const top = [...rows].filter((r) => r.categories?.[k] !== null && r.categories?.[k] !== undefined)
          .sort((a, b) => b.categories[k] - a.categories[k]).slice(0, 5);
        return `<div class="card"><h3>${cats[k].label}</h3><table class="compact"><tbody>${top.map((r, i) => `<tr>
          <td class="muted">${i + 1}</td><td><a href="company.html?t=${r.ticker}"><b>${r.ticker}</b></a></td>
          <td class="num">${f.num(r.categories[k], 0)}</td><td>${statusHtml(r.light)}</td></tr>`).join("")}</tbody></table></div>`;
      }).join("")}</div>
    </section>`;

  const q = sector.quarters;
  const labels = q.map((k) => `${k.slice(4)} ${k.slice(0, 4)}`);
  const m = sector.median;
  const tail = (arr, n = 24) => arr.slice(-n);

  charts.line(document.getElementById("s-pnav"),
    [{ name: "Медиана P/NAV", data: sector.p_nav.dates.map((d, i) => [d, sector.p_nav.median[i]]) }],
    { yFmt: (v) => f.ratio(v), refLines: [{ y: 1, label: "= NAV" }] });
  charts.bars(document.getElementById("s-econ"), [{ name: "Медиана", data: tail(m.econ_return) }],
    { categories: tail(labels), yFmt: (v) => f.pct(v, 1), colorBySign: true });
  charts.line(document.getElementById("s-cov"), [{ name: "Медиана", data: tail(m.coverage) }],
    { time: false, categories: tail(labels), yFmt: (v) => f.pct(v, 0), refLines: [{ y: 1, label: "100%" }] });
  const naIdx = m.nonaccrual_cost.map((v, i) => (v === null ? null : i)).filter((i) => i !== null);
  const naEl = document.getElementById("s-na");
  if (naIdx.length) {
    charts.line(naEl, [{ name: "Медиана", data: naIdx.map((i) => m.nonaccrual_cost[i]) }],
      { time: false, categories: naIdx.map((i) => labels[i]), yFmt: (v) => f.pct(v, 1), yMin: 0 });
  } else {
    naEl.outerHTML = `<p class="empty">Още няма достатъчно данни.</p>`;
  }
  charts.line(document.getElementById("s-de"), [{ name: "Медиана", data: tail(m.de) }],
    { time: false, categories: tail(labels), yFmt: (v) => f.ratio(v) });
  charts.line(document.getElementById("s-pik"), [{ name: "Медиана", data: tail(m.pik_pct) }],
    { time: false, categories: tail(labels), yFmt: (v) => f.pct(v, 0), yMin: 0 });

  const ranked = rows.filter((r) => !r.incomplete).sort((a, b) => b.total - a.total);
  const unrated = rows.filter((r) => r.incomplete).map((r) => r.ticker);
  const rankEl = document.getElementById("s-rank");
  charts.hbars(rankEl, ranked.map((r) => r.ticker), ranked.map((r) => r.total), {
    fmt: (v) => f.num(v, 0),
    max: 100,
    labelWidth: 60,
    colors: ranked.map((r) => (t) => ({ green: t.good, yellow: t.warn, red: t.bad })[r.light] ?? t.axis),
  });
  echarts.getInstanceByDom(rankEl)?.on("click", (p) => (location.href = `company.html?t=${p.name}`));
  if (unrated.length) document.getElementById("s-unrated").textContent = `Без класиране поради непълни данни: ${unrated.join(", ")}.`;
  charts.dataTable(rankEl.parentElement, ["BDC", "Скор", "Светофар"], ranked.map((r) => [r.ticker, f.num(r.total, 0), LIGHT_LABEL[r.light] ?? f.DASH]));
}

main();
