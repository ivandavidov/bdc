// Обща шапка, долен колонтитул и превключване на темата.
import { getPref, setPref } from "./store.js";
import * as data from "./data.js";
import { date } from "./format.js";

const NAV = [
  ["index.html", "Табло"],
  ["compare.html", "Сравнение"],
  ["sector.html", "Сектор"],
  ["changes.html", "Промени"],
  ["methodology.html", "Методология"],
  ["learn.html", "Какво е BDC"],
  ["glossary.html", "Речник"],
];

const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)"/>
<rect x="8" y="17" width="4" height="8" rx="1.5" fill="#fff"/><rect x="14" y="12" width="4" height="13" rx="1.5" fill="#fff"/>
<rect x="20" y="7" width="4" height="18" rx="1.5" fill="#fff"/></svg>`;

const THEMES = ["auto", "dark", "light"];
const THEME_LABEL = { auto: "Тема: автоматична", dark: "Тема: тъмна", light: "Тема: светла" };
const THEME_ICON = { auto: "◐", dark: "☾", light: "☀" };

function applyTheme(mode) {
  if (mode === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
  window.dispatchEvent(new CustomEvent("themechange"));
}

export function isDark() {
  const forced = document.documentElement.getAttribute("data-theme");
  if (forced) return forced === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function initLayout() {
  let mode = getPref("theme", "auto");
  if (!THEMES.includes(mode)) mode = "auto";
  applyTheme(mode);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getPref("theme", "auto") === "auto") window.dispatchEvent(new CustomEvent("themechange"));
  });

  const here = location.pathname.split("/").pop() || "index.html";
  const header = document.createElement("header");
  header.className = "site-header";
  header.innerHTML = `<div class="header-inner">
    <a class="brand" href="index.html">${LOGO}<span>BDC Радар</span></a>
    <nav class="nav" aria-label="Основна навигация">${NAV.map(
      ([href, label]) => `<a href="${href}"${href === here || (here === "company.html" && href === "index.html") ? ' aria-current="page"' : ""}>${label}</a>`,
    ).join("")}</nav>
    <button class="icon-btn" id="theme-toggle" type="button"></button>
  </div>`;
  document.body.prepend(header);

  const btn = header.querySelector("#theme-toggle");
  const paint = () => {
    btn.textContent = THEME_ICON[mode];
    btn.title = THEME_LABEL[mode];
    btn.setAttribute("aria-label", THEME_LABEL[mode]);
  };
  paint();
  btn.addEventListener("click", () => {
    mode = THEMES[(THEMES.indexOf(mode) + 1) % THEMES.length];
    setPref("theme", mode);
    applyTheme(mode);
    paint();
  });

  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.innerHTML = `<div class="inner">
    <div class="disclaimer"><strong>Информацията на сайта не представлява инвестиционен съвет.</strong> Сайтът обобщава публични данни с автоматични изчисления, които може да съдържат грешки.
    Проверявайте оригиналните отчети преди решение.</div>
    <div>Източници: SEC EDGAR (XBRL отчети 10-Q/10-K), Yahoo Finance (цени и дивиденти). <span id="data-stamp"></span></div>
    <div><a href="methodology.html">Методология</a> · <a href="feed.xml">RSS на промените</a></div>
  </div>`;
  document.body.append(footer);
  data.meta().then((m) => {
    const el = footer.querySelector("#data-stamp");
    if (el && m?.generated) el.textContent = `Данните са обновени на ${date(m.generated)}.`;
  }).catch(() => {});
}
