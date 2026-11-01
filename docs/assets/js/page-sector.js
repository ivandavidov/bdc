import { initLayout } from "./layout.js";
import * as data from "./data.js";
import * as f from "./format.js";
import * as charts from "./charts.js";
import { CATEGORY_ORDER, LIGHT_LABEL, setScoring, statusHtml } from "./metrics-def.js";

initLayout();

const card = (id, title, desc, cls = "chart") =>
  `<div class="card"><h3>${title}</h3>${desc ? `<p class="secondary small">${desc}</p>` : ""}<div class="${cls}" id="${id}"></div></div>`;

const tile = (label, value, sub = "") =>
  `<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;

function healthHtml() {
  return `
    <section>
      <h2>Здраве на портфейлите</h2>
      <p class="secondary">Какво казват отчетите на кредиторите за компаниите, които финансират. Сумите са за всички BDC заедно,
        затова по-големите портфейли тежат повече. Това са непреки сигнали: финансовите отчети на самите кредитополучатели не са публични.</p>
      <div class="tiles" id="h-tiles"></div>
      <div class="grid grid-2" style="margin-top:16px">
        ${card("h-fvc", "Справедлива стойност / цена на придобиване", "Под 100% означава, че кредиторите са обезценили заемите.")}
        ${card("h-na", "Non-accruals", "Заеми, по които не се начислява лихва, като дял от портфейла. Разликата между двете линии показва колко очакват да загубят по тях.")}
        ${card("h-yield", "Доходност на портфейла и NII", "Годишен инвестиционен доход ÷ портфейл и годишен NII ÷ NAV. Отразяват главно лихвените нива.")}
        ${card("h-pik", "PIK доход", "Дял на лихвата, платена с нов дълг вместо с пари. Високият дял е знак за недостиг на пари при кредитополучателите.")}
      </div>
      <div class="card" style="margin-top:16px">
        <h3>Кредитополучатели с проблеми при няколко BDC</h3>
        <p class="secondary small">Компании, които са в non-accrual при поне два BDC. Ако един и същ заем е лош при различни кредитори, проблемът е в компанията, а не в оценката на един мениджър.</p>
        <div id="h-shared"></div>
      </div>
      <p class="small muted">Тримесечия с по-малко от 25 отчели BDC не се показват. Списъкът non-accruals се води от 3-то тримесечие на 2025 г.
        Имената се съпоставят автоматично по най-големите 15 non-accruals на всеки BDC, така че списъкът може да е непълен.</p>
    </section>`;
}

function renderHealth(h) {
  const s = h.series;
  const n = s.quarters.length;
  const labels = s.quarters.map((k) => `${k.slice(4)} ${k.slice(0, 4)}`);
  const last = n - 1;
  const yearAgo = n - 5;
  const lastNa = s.nonaccrual_cost.findLastIndex((v) => v !== null);
  const firstNa = s.nonaccrual_cost.findIndex((v) => v !== null);
  const was = (arr, i, fmt) => (i >= 0 && arr[i] !== null ? `${labels[i]}: ${fmt(arr[i])}` : "");

  document.getElementById("h-tiles").innerHTML = [
    tile("Портфейл общо", f.compactMoney(s.fv[last]), `${f.int(s.count[last])} BDC, ${labels[last]}`),
    tile("Стойност / цена", f.pct(s.fv_cost[last]), was(s.fv_cost, yearAgo, (v) => f.pct(v))),
    tile("Нереализирана загуба", f.compactMoney(s.unrealized[last]), was(s.unrealized, yearAgo, f.compactMoney)),
    tile("Non-accruals по цена", f.pct(s.nonaccrual_cost[lastNa]), lastNa !== firstNa ? was(s.nonaccrual_cost, firstNa, (v) => f.pct(v)) : ""),
    tile("Non-accruals по стойност", f.pct(s.nonaccrual_fv[lastNa]), "очаквано връщане ≈ " + f.pct(s.nonaccrual_fv[lastNa] / s.nonaccrual_cost[lastNa], 0)),
    tile("PIK дял в дохода", f.pct(s.pik_pct[last]), was(s.pik_pct, yearAgo, (v) => f.pct(v))),
    tile("Портфейл с PIK", f.pct(h.current.pik_exposure, 0), `последен отчет, ${f.int(h.current.pik_exposure_n)} BDC`),
    tile("Доходност на дълга", f.pct(h.current.debt_yield), `плаващ лихвен процент: ${f.pct(h.current.floating, 0)}`),
  ].join("");

  charts.line(document.getElementById("h-fvc"), [{ name: "Стойност / цена", data: s.fv_cost }],
    { time: false, categories: labels, yFmt: (v) => f.pct(v, 1), refLines: [{ y: 1, label: "100%" }] });
  const naIdx = s.nonaccrual_cost.map((v, i) => (v === null ? null : i)).filter((i) => i !== null);
  charts.line(document.getElementById("h-na"), [
    { name: "По цена на придобиване", data: naIdx.map((i) => s.nonaccrual_cost[i]) },
    { name: "По справедлива стойност", data: naIdx.map((i) => s.nonaccrual_fv[i]) },
  ], { time: false, categories: naIdx.map((i) => labels[i]), yFmt: (v) => f.pct(v, 1), yMin: 0 });
  charts.line(document.getElementById("h-yield"), [
    { name: "Доходност на портфейла", data: s.income_yield },
    { name: "NII ÷ NAV", data: s.nii_roe },
  ], { time: false, categories: labels, yFmt: (v) => f.pct(v, 1) });
  charts.line(document.getElementById("h-pik"), [{ name: "PIK ÷ инвестиционен доход", data: s.pik_pct }],
    { time: false, categories: labels, yFmt: (v) => f.pct(v, 0), yMin: 0 });

  charts.dataTable(document.getElementById("h-yield").parentElement.parentElement,
    ["Тримесечие", "BDC", "Стойност / цена", "Нереализирана", "Non-accruals (цена)", "Non-accruals (стойност)", "PIK", "Доходност", "NII ÷ NAV"],
    s.quarters.map((_, i) => [labels[i], f.int(s.count[i]), f.pct(s.fv_cost[i]), f.compactMoney(s.unrealized[i]),
      f.pct(s.nonaccrual_cost[i]), f.pct(s.nonaccrual_fv[i]), f.pct(s.pik_pct[i]), f.pct(s.income_yield[i]), f.pct(s.nii_roe[i])]));

  const shared = h.shared_nonaccruals;
  document.getElementById("h-shared").innerHTML = shared.length
    ? `<div class="table-wrap"><table class="compact"><thead><tr>
        <th>Компания</th><th>BDC</th><th class="num">Цена на придобиване</th><th class="num">Стойност / цена</th></tr></thead>
        <tbody>${shared.map((g) => `<tr><td>${f.escapeHtml(g.name)}</td>
          <td>${g.tickers.map((t) => `<a href="company.html?t=${t}">${t}</a>`).join(", ")}</td>
          <td class="num">${f.compactMoney(g.cost)}</td><td class="num">${f.pct(g.fv_cost, 0)}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="empty">Няма компании в non-accrual при повече от един BDC.</p>`;
}

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
    ${sector.health ? healthHtml() : ""}
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

  if (sector.health) renderHealth(sector.health);

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
