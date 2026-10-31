// Ред от дневника на промените (табло, профил, страница „Промени“).
import * as f from "./format.js";

const SEVERITY = {
  good: { dot: "green", label: "Добро" },
  bad: { dot: "red", label: "Внимание" },
  info: { dot: "", label: "Инфо" },
};

export function eventHtml(e, { showTicker = true } = {}) {
  const sev = SEVERITY[e.severity] ?? SEVERITY.info;
  const who = showTicker ? `<a href="company.html?t=${e.ticker}"><b>${e.ticker}</b></a>` : `<span class="muted small">${sev.label}</span>`;
  return `<div class="event"><span class="when">${f.date(e.date)}</span>${who}
    <span><span class="sev"><span class="dot ${sev.dot}" title="${sev.label}"></span><span class="sr-only">${sev.label}: </span></span> ${f.escapeHtml(e.text)}</span></div>`;
}
