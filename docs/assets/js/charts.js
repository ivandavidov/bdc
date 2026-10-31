// Обвивки около Apache ECharts: еднакъв вид (тънки линии, бледа мрежа, една ос),
// подсказки при посочване, таблица с данните под всяка графика и смяна на темата.
import * as f from "./format.js";

const charts = new Set();

export function tokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    surface: v("--surface"),
    surface2: v("--surface-2"),
    text: v("--text"),
    text2: v("--text-2"),
    muted: v("--muted"),
    grid: v("--grid"),
    axis: v("--axis"),
    border: v("--border"),
    accent: v("--accent"),
    good: v("--good"),
    warn: v("--warn"),
    bad: v("--bad"),
    series: [v("--series-1"), v("--series-2"), v("--series-3"), v("--series-4")],
    seq: [v("--seq-1"), v("--seq-2")],
  };
}

function mount(el, build) {
  const render = () => {
    const existing = echarts.getInstanceByDom(el);
    if (existing) existing.dispose();
    const chart = echarts.init(el, null, { renderer: "svg" });
    chart.setOption(build(tokens()));
    return chart;
  };
  const entry = { el, render, chart: render() };
  charts.add(entry);
  return entry;
}

window.addEventListener("themechange", () => {
  for (const entry of charts) {
    if (!entry.el.isConnected) {
      charts.delete(entry);
      continue;
    }
    entry.chart = entry.render();
  }
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => charts.forEach((e) => e.chart?.resize()), 120);
});

export function clearCharts(container) {
  for (const entry of charts) {
    if (container.contains(entry.el)) {
      echarts.getInstanceByDom(entry.el)?.dispose();
      charts.delete(entry);
    }
  }
}

function baseAxis(t, extra = {}) {
  return {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true },
    splitLine: { lineStyle: { color: t.grid, type: "solid", width: 1 } },
    ...extra,
  };
}

function tooltip(t, extra = {}) {
  return {
    backgroundColor: t.surface,
    borderColor: t.border,
    borderWidth: 1,
    textStyle: { color: t.text, fontSize: 12 },
    extraCssText: "box-shadow:0 4px 14px rgba(0,0,0,.12);border-radius:8px;",
    ...extra,
  };
}

function marker(color) {
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px"></span>`;
}

function axisTooltipFormatter(fmt, isTime) {
  return (params) => {
    const list = Array.isArray(params) ? params : [params];
    if (!list.length) return "";
    const first = list[0];
    const head = isTime ? f.date(new Date(first.value[0]).toISOString()) : first.axisValueLabel ?? first.name;
    const rows = list
      .filter((p) => p.seriesName && !p.seriesName.startsWith("_"))
      .map((p) => {
        const val = Array.isArray(p.value) ? p.value[1] : p.value?.value ?? p.value;
        return `<div>${marker(p.color)}${f.escapeHtml(p.seriesName)}: <b>${fmt(val)}</b></div>`;
      });
    return `<div style="font-weight:600;margin-bottom:4px">${head}</div>${rows.join("")}`;
  };
}

function refLineSeries(t, refLines, isTime) {
  if (!refLines?.length) return [];
  return [{
    name: "_ref",
    type: "line",
    data: [],
    silent: true,
    markLine: {
      symbol: "none",
      silent: true,
      label: { color: t.muted, fontSize: 11, formatter: (p) => p.name, position: "insideEndTop" },
      lineStyle: { color: t.axis, type: "solid", width: 1 },
      data: refLines.map((r) => ({ yAxis: r.y, name: r.label ?? "" })),
    },
    ...(isTime ? {} : {}),
  }];
}

/**
 * Линейна графика. series: [{name, data: [[iso, value], ...] | [value...], color?, area?, step?, symbols?}]
 * opts: {yFmt, time = true, categories, refLines, yMin, legend}
 */
export function line(el, series, opts = {}) {
  const isTime = opts.time !== false;
  const yFmt = opts.yFmt ?? ((x) => f.num(x));
  return mount(el, (t) => ({
    animation: false,
    color: series.map((s, i) => s.color ?? t.series[i % t.series.length]),
    grid: { left: 8, right: 16, top: series.length > 1 || opts.legend ? 34 : 14, bottom: 8, containLabel: true },
    legend: series.length > 1 || opts.legend
      ? { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 3, textStyle: { color: t.text2, fontSize: 12 }, data: series.map((s) => s.name) }
      : undefined,
    tooltip: tooltip(t, { trigger: "axis", axisPointer: { type: "line", lineStyle: { color: t.axis } }, formatter: axisTooltipFormatter(yFmt, isTime) }),
    xAxis: isTime
      ? baseAxis(t, { type: "time", splitLine: { show: false } })
      : baseAxis(t, { type: "category", data: opts.categories, splitLine: { show: false }, boundaryGap: false }),
    yAxis: baseAxis(t, { type: "value", scale: opts.yMin === undefined, min: opts.yMin, axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => yFmt(v) } }),
    series: [
      ...series.map((s, i) => ({
        name: s.name,
        type: "line",
        data: s.data,
        step: s.step ? "end" : false,
        connectNulls: false,
        showSymbol: s.symbols ?? s.data.length <= 24,
        symbolSize: 8,
        lineStyle: { width: 2, type: s.dashed ? [4, 4] : "solid", cap: "round", join: "round" },
        itemStyle: { borderColor: t.surface, borderWidth: 2 },
        areaStyle: s.area ? { opacity: 0.1 } : undefined,
        emphasis: { focus: "none", scale: 1.25 },
        z: series.length - i + 2,
      })),
      ...refLineSeries(t, opts.refLines, isTime),
    ],
  }));
}

/**
 * Колонкова графика по категории (тримесечия). series: [{name, data: [values], type?: "bar"|"line", color?}]
 * opts: {categories, yFmt, refLines, colorBySign}
 */
export function bars(el, series, opts = {}) {
  const yFmt = opts.yFmt ?? ((x) => f.num(x));
  return mount(el, (t) => ({
    animation: false,
    color: series.map((s, i) => s.color ?? t.series[i % t.series.length]),
    grid: { left: 8, right: 16, top: series.length > 1 ? 34 : 14, bottom: 8, containLabel: true },
    legend: series.length > 1
      ? { top: 0, left: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: t.text2, fontSize: 12 }, data: series.map((s) => s.name) }
      : undefined,
    tooltip: tooltip(t, { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,0.08)" } }, formatter: axisTooltipFormatter(yFmt, false) }),
    xAxis: baseAxis(t, { type: "category", data: opts.categories, splitLine: { show: false } }),
    yAxis: baseAxis(t, { type: "value", axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => yFmt(v) } }),
    series: [
      ...series.map((s) => (s.type === "line"
        ? {
            name: s.name, type: "line", data: s.data, step: s.step ? "middle" : false, showSymbol: s.data.length <= 24, symbolSize: 8,
            lineStyle: { width: 2 }, itemStyle: { borderColor: t.surface, borderWidth: 2 }, z: 5,
          }
        : {
            name: s.name,
            type: "bar",
            barMaxWidth: 24,
            barGap: "12%",
            data: s.data.map((v) => ({
              value: v,
              itemStyle: {
                borderRadius: v !== null && v < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0],
                color: opts.colorBySign && v !== null ? (v < 0 ? t.bad : s.color ?? t.series[0]) : undefined,
              },
            })),
          })),
      ...refLineSeries(t, opts.refLines, false),
    ],
  }));
}

/** Хоризонтални ленти (една серия, един цвят), подредени отгоре надолу. */
export function hbars(el, labels, values, opts = {}) {
  const fmt = opts.fmt ?? ((x) => f.pct(x));
  const colors = opts.colors;
  return mount(el, (t) => ({
    animation: false,
    grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
    tooltip: tooltip(t, { trigger: "item", formatter: (p) => `${f.escapeHtml(p.name)}: <b>${fmt(p.value)}</b>` }),
    xAxis: { type: "value", show: false, max: opts.max },
    yAxis: {
      type: "category", inverse: true, data: labels,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: t.text2, fontSize: 12, width: opts.labelWidth ?? 150, overflow: "truncate" },
    },
    series: [{
      type: "bar", barMaxWidth: 16,
      data: values.map((v, i) => ({ value: v, itemStyle: { color: colors ? colors[i](t) : t.accent, borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: "right", color: t.text2, fontSize: 11, formatter: (p) => fmt(p.value) },
    }],
  }));
}

/** Разпръсната графика с етикети (тикери). points: [{name, x, y, color, group}] */
export function scatter(el, groups, opts = {}) {
  return mount(el, (t) => ({
    animation: false,
    grid: { left: 8, right: 24, top: 34, bottom: 28, containLabel: true },
    legend: { top: 0, left: 0, textStyle: { color: t.text2, fontSize: 12 }, data: groups.map((g) => g.name) },
    tooltip: tooltip(t, { trigger: "item", formatter: opts.tooltip }),
    xAxis: baseAxis(t, {
      type: "value", scale: true, name: opts.xName, nameLocation: "middle", nameGap: 26, nameTextStyle: { color: t.muted, fontSize: 11 },
      axisLabel: { color: t.muted, fontSize: 11, formatter: opts.xFmt },
    }),
    yAxis: baseAxis(t, {
      type: "value", min: opts.yMin, max: opts.yMax, name: opts.yName, nameTextStyle: { color: t.muted, fontSize: 11, align: "left" },
      axisLabel: { color: t.muted, fontSize: 11, formatter: opts.yFmt },
    }),
    series: [
      ...groups.map((g) => ({
        name: g.name,
        type: "scatter",
        symbolSize: 10,
        itemStyle: { color: g.color(t), borderColor: t.surface, borderWidth: 2 },
        data: g.points.map((p) => ({ name: p.name, value: [p.x, p.y], raw: p })),
        label: { show: true, position: "right", formatter: (p) => p.name, color: t.muted, fontSize: 10 },
        labelLayout: { hideOverlap: true },
        emphasis: { scale: 1.4, label: { color: t.text, fontWeight: 600 } },
      })),
      ...(opts.vLine !== undefined
        ? [{
            name: "_ref", type: "scatter", data: [], silent: true,
            markLine: {
              symbol: "none", silent: true, lineStyle: { color: t.axis, type: "solid" },
              label: { color: t.muted, fontSize: 11, formatter: opts.vLineLabel ?? "", position: "insideStartTop" },
              data: [{ xAxis: opts.vLine }],
            },
          }]
        : []),
    ],
  }));
}

/** Скрита таблица с данните на графиката (достъпност и точни стойности). */
export function dataTable(container, headers, rows, title = "Покажи данните като таблица") {
  const details = document.createElement("details");
  details.className = "data-table";
  details.innerHTML = `<summary>${title}</summary><div class="table-wrap"><table class="compact">
    <thead><tr>${headers.map((h, i) => `<th${i ? ' class="num"' : ""}>${f.escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
  container.append(details);
  return details;
}
