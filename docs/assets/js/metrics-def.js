// Описание на показателите: етикет, формат, посока (кое е добре) и кратко обяснение.
import * as f from "./format.js";

export const LIGHT_LABEL = { green: "Силна", yellow: "Средна", red: "Слаба" };
export const VALUATION_LABEL = { cheap: "Евтина", fair: "Нормална", expensive: "Скъпа" };
export const MANAGED_LABEL = { internal: "Вътрешно", external: "Външно" };
export const CATEGORY_ORDER = ["dividend", "nav", "credit", "leverage", "costs"];

// dir: 1 = по-високо е по-добре, -1 = по-ниско е по-добре, 0 = неутрално
// (P/NAV и доходността са неутрални: по-евтино или по-висока доходност не значи „по-добре“)
export const METRICS = {
  total: { label: "Оценка", fmt: (x) => f.num(x, 0), dir: 1, help: "Оценка за качество 0–100 по методологията." },
  price: { label: "Цена", fmt: (x) => f.money(x), dir: 0, help: "Последна цена на затваряне." },
  nav_ps: { label: "NAV/акция", fmt: (x) => f.money(x), dir: 0, help: "Нетна стойност на активите на акция от последния отчет.", g: "nav" },
  p_nav: { label: "P/NAV", fmt: (x) => f.ratio(x), dir: 0, help: "Цена ÷ NAV/акция. Под 1 = акцията се търгува с отстъпка от счетоводната стойност.", g: "p-nav" },
  p_nav_avg_3y: { label: "P/NAV, ср. 3 г.", fmt: (x) => f.ratio(x), dir: 0, help: "Средна седмична P/NAV за последните 3 години." },
  yield_fwd: { label: "Доходност", fmt: (x) => f.pct(x), dir: 0, help: "Текущ редовен дивидент, анюализиран, ÷ цена (без специални дивиденти).", g: "yield" },
  yield_ttm: { label: "Доходност (12 м.)", fmt: (x) => f.pct(x), dir: 0, help: "Всички дивиденти (вкл. специални) за последните 12 месеца ÷ цена." },
  coverage_ttm: { label: "Покритие", fmt: (x) => f.pct(x, 0), dir: 1, help: "NII/акция ÷ редовен дивидент за последните 4 тримесечия. Над 100% = доходът покрива дивидента.", g: "coverage" },
  coverage_q: { label: "Покритие (тримесечие)", fmt: (x) => f.pct(x, 0), dir: 1, help: "Покритие за последното тримесечие." },
  cuts_5y: { label: "Съкращения (5 г.)", fmt: (x) => f.int(x), dir: -1, help: "Брой намаления на редовния дивидент за 5 години (автоматично засечени)." },
  div_change_1y: { label: "Дивидент Δ (1 г.)", fmt: (x) => f.signedPct(x), dir: 1, help: "Промяна на редовния дивидент спрямо преди година." },
  pik_pct_ttm: { label: "PIK доход", fmt: (x) => f.pct(x), dir: -1, help: "Дял на безкасовия (PIK) лихвен доход в общия инвестиционен доход.", g: "pik" },
  nav_chg_1y: { label: "NAV Δ (1 г.)", fmt: (x) => f.signedPct(x), dir: 1, help: "Промяна на NAV/акция за 4 тримесечия." },
  nav_chg_3y: { label: "NAV Δ (3 г.)", fmt: (x) => f.signedPct(x), dir: 1, help: "Промяна на NAV/акция за 12 тримесечия." },
  nav_tr_1y: { label: "Доходност на NAV (1 г.)", fmt: (x) => f.signedPct(x), dir: 1, help: "(Промяна на NAV + дивиденти) ÷ начален NAV.", g: "nav-tr" },
  nav_tr_3y: { label: "Доходност на NAV (3 г.)", fmt: (x) => f.signedPct(x), dir: 1, help: "Годишна доходност на NAV за 3 години (с дивидентите).", g: "nav-tr" },
  nav_cagr_long: { label: "NAV Δ (дълъг период)", fmt: (x) => f.signedPct(x), dir: 1, help: "Годишна промяна на NAV/акция за до 10 години (поне 5), по всички отчетени стойности, вкл. годишните.", g: "nav" },
  nav_tr_5y: { label: "Доходност на NAV (5 г.)", fmt: (x) => f.signedPct(x), dir: 1, help: "Годишна доходност на NAV за 5 години (с дивидентите).", g: "nav-tr" },
  nonaccrual_cost: { label: "Необслужвани заеми", fmt: (x) => f.pct(x, 1), dir: -1, help: "Заеми, по които не се начислява лихва, % от портфейла по цена на придобиване (участва в оценката).", g: "non-accrual" },
  nonaccrual_fv: { label: "Необслужвани (по спр. ст.)", fmt: (x) => f.pct(x, 1), dir: -1, help: "Необслужвани заеми по справедлива стойност. Подценява проблема, защото лошите заеми вече са обезценени." },
  fv_cost: { label: "FV/цена", fmt: (x) => f.pct(x, 1), dir: 1, help: "Справедлива стойност ÷ цена на придобиване на портфейла. Под 100% = натрупани обезценки.", g: "fv-cost" },
  first_lien: { label: "Първи по ред залог", fmt: (x) => f.pct(x, 0), dir: 1, help: "Дял на заемите с първи по ред залог (first lien / senior secured).", g: "first-lien" },
  top10: { label: "10-те най-големи", fmt: (x) => f.pct(x, 0), dir: -1, help: "Дял на 10-те най-големи компании в портфейла." },
  n_companies: { label: "Компании", fmt: (x) => f.int(x), dir: 0, help: "Брой портфейлни компании." },
  floating: { label: "Плаваща лихва", fmt: (x) => f.pct(x, 0), dir: 0, help: "Дял на дълговия портфейл с плаваща лихва." },
  de: { label: "D/E", fmt: (x) => f.ratio(x), dir: -1, help: "(Дълг + привилегировани акции) ÷ NAV на обикновените акции.", g: "leverage" },
  net_de: { label: "Нетен D/E", fmt: (x) => f.ratio(x), dir: -1, help: "(Дълг + привилегировани акции − кеш) ÷ NAV.", g: "leverage" },
  asset_coverage: { label: "Покритие с активи", fmt: (x) => f.pct(x, 0), dir: 1, help: "Покритие на дълга с активи (asset coverage): колко долара активи има BDC за всеки долар дълг. Законовият минимум е 150% (D/E най-много 2,0x). По-ниско покритие означава повече дълг.", g: "asset-coverage" },
  opex_ratio: { label: "Разходи", fmt: (x) => f.pct(x, 1), dir: -1, help: "Оперативни разходи без лихви (такси, администрация) за 12 месеца ÷ среден NAV.", g: "expense" },
  managed: { label: "Управление", fmt: (x) => MANAGED_LABEL[x] ?? f.DASH, dir: 0, help: "Вътрешно управляваните BDC нямат външно управляващо дружество, което събира такси.", g: "internal" },
  market_cap: { label: "Пазарна кап.", fmt: (x) => f.compactMoney(x), dir: 0, help: "Цена × брой акции." },
  net_assets: { label: "NAV общо", fmt: (x) => f.compactMoney(x), dir: 0, help: "Нетни активи (собствен капитал)." },
  investments_fv: { label: "Портфейл", fmt: (x) => f.compactMoney(x), dir: 0, help: "Инвестиции по справедлива стойност." },
  insiders_pct: { label: "Вътрешни лица", fmt: (x) => f.pct(x, 1), dir: 0, help: "Дял на акциите, държани от ръководството, директорите и управляващото дружество." },
  institutions_pct: { label: "Институционални инвеститори", fmt: (x) => f.pct(x, 0), dir: 0, help: "Дял на акциите, държани от институционални инвеститори (по отчети 13F)." },
  tsr_1y: { label: "Обща доходност (1 г.)", fmt: (x) => f.signedPct(x), dir: 1, help: "Доходност за акционера (цена + реинвестирани дивиденти) за 1 година." },
  tsr_3y: { label: "Обща доходност (3 г.)", fmt: (x) => f.signedPct(x), dir: 1, help: "Доходност за акционера за 3 години (кумулативно)." },
  nii_roe_ttm: { label: "NII/NAV", fmt: (x) => f.pct(x), dir: 1, help: "Нетен инвестиционен доход за 12 месеца ÷ NAV в началото." },
  data_age_days: { label: "Възраст на данните", fmt: (x) => `${f.int(x)} дни`, dir: -1, help: "Дни от последния отчетен период." },
};

let scoringConfig = null;
export function setScoring(cfg) {
  scoringConfig = cfg;
}

function interpolate(value, points) {
  if (value <= points[0][0]) return points[0][1];
  if (value >= points[points.length - 1][0]) return points[points.length - 1][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (value <= x1) return y0 + ((y1 - y0) * (value - x0)) / (x1 - x0);
  }
  return points[points.length - 1][1];
}

export function lightFor(score) {
  if (score === null || score === undefined) return null;
  const th = scoringConfig?.thresholds ?? { green: 70, yellow: 50 };
  return score >= th.green ? "green" : score >= th.yellow ? "yellow" : "red";
}

// Точки 0–100 за показател, който участва в оценката; null за останалите.
export function subscore(key, value) {
  if (!scoringConfig || value === null || value === undefined) return null;
  for (const cat of Object.values(scoringConfig.categories)) {
    const m = cat.metrics[key];
    if (m) return interpolate(value, m.points);
  }
  return null;
}

export function metricLight(key, value) {
  return lightFor(subscore(key, value));
}

export function statusHtml(light, score) {
  if (!light) {
    const s = score === undefined || score === null ? "" : `${f.num(score, 0)} `;
    return `<span class="score-pill" title="Липсват данни за над 30% от теглото на оценката, затова светофар не се дава"><span class="dot"></span>${s}<span class="status-text">Непълни данни</span></span>`;
  }
  const s = score === undefined || score === null ? "" : `${f.num(score, 0)} `;
  return `<span class="score-pill"><span class="dot ${light}"></span>${s}<span class="status-text">${LIGHT_LABEL[light]}</span></span>`;
}

// Стойност с цветна точка, когато показателят участва в оценката (цветът никога не е единственият сигнал).
export function valueWithDot(key, value) {
  const def = METRICS[key];
  const text = def ? def.fmt(value) : f.num(value);
  const light = metricLight(key, value);
  if (!light) return text;
  return `<span class="cell-dot" title="${LIGHT_LABEL[light]}"><span class="dot ${light}" aria-hidden="true"></span>${text}</span>`;
}
