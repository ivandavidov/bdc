"""Turn SEC companyfacts JSON into quarterly series keyed by period-end date.

BDC 10-Qs often report year-to-date amounts only (financial highlights in
particular), so a quarter is derived as YTD(this quarter) - YTD(previous
quarter) when no three-month fact exists. Q4 falls out of FY - 9M the same way.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

import yaml

from . import sec

TAGS = yaml.safe_load((sec.ROOT / "config" / "xbrl_tags.yaml").read_text())
PERIODIC_FORMS = ("10-K", "10-Q")


def _date(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def _days(a: str, b: str) -> int:
    return (_date(b) - _date(a)).days


def _raw(facts: dict, tag: str, unit: str) -> list[dict]:
    ns, _, name = tag.rpartition(":")
    node = facts.get("facts", {}).get(ns or "us-gaap", {}).get(name)
    if not node:
        return []
    return [f for f in node.get("units", {}).get(unit, []) if f.get("form", "").startswith(PERIODIC_FORMS)]


def _split_adjust(rows: list[dict], unit: str, splits: list[tuple[str, float]]) -> list[dict]:
    """Restate per-share values and share counts filed before a split into today's share basis.

    Filings after a split restate their comparatives, so only facts *filed*
    before the split date need adjusting. ratio = new shares / old shares.
    """
    if not splits or unit not in ("USD/shares", "shares"):
        return rows
    out = []
    for r in rows:
        val = r["val"]
        for date, ratio in splits:
            if r["filed"] < date and r["end"] < date:
                val = val / ratio if unit == "USD/shares" else val * ratio
        out.append({**r, "val": val})
    return out


def _latest_by_period(rows: list[dict]) -> dict[tuple[str | None, str], float]:
    """Keep the most recently filed value for each (start, end) — picks up restatements."""
    best: dict[tuple[str | None, str], tuple[str, float]] = {}
    for r in rows:
        key = (r.get("start"), r["end"])
        if key not in best or r["filed"] >= best[key][0]:
            best[key] = (r["filed"], r["val"])
    return {k: v for k, (_, v) in best.items()}


def instant_series(facts: dict, spec: dict, splits) -> dict[str, float]:
    out: dict[str, float] = {}
    for tag in spec["tags"]:
        rows = _split_adjust(_raw(facts, tag, spec["unit"]), spec["unit"], splits)
        for (_, end), val in _latest_by_period(rows).items():
            out.setdefault(end, val)
    return out


def _duration_by_end(facts: dict, spec: dict, splits) -> dict[str, dict[str, float]]:
    """{end: {start: value}} merged across candidate tags (first tag wins per period)."""
    by_end: dict[str, dict[str, float]] = defaultdict(dict)
    for tag in spec["tags"]:
        rows = _split_adjust(_raw(facts, tag, spec["unit"]), spec["unit"], splits)
        for (start, end), val in _latest_by_period(rows).items():
            if start:
                by_end[end].setdefault(start, val)
    return by_end


def _prev_quarter(q: str, qends: list[str]) -> str | None:
    for p in reversed(qends):
        if p < q and 75 <= _days(p, q) <= 105:
            return p
    return None


def quarterly_series(facts: dict, spec: dict, qends: list[str], splits) -> dict[str, float]:
    by_end = _duration_by_end(facts, spec, splits)
    out: dict[str, float] = {}
    for q in qends:
        starts = by_end.get(q, {})
        direct = [v for s, v in starts.items() if 75 <= _days(s, q) <= 105]
        if direct:
            out[q] = direct[0]
            continue
        p = _prev_quarter(q, qends)
        if not p:
            continue
        for s, ytd in sorted(starts.items()):
            if _days(s, q) > 150 and s in by_end.get(p, {}):
                out[q] = ytd - by_end[p][s]
                break
    return out


def annual_series(facts: dict, spec: dict, splits) -> dict[str, float]:
    """Full fiscal-year values ({end: value}); a fallback when quarters are incomplete."""
    out: dict[str, float] = {}
    for end, starts in _duration_by_end(facts, spec, splits).items():
        for start, val in starts.items():
            if 350 <= _days(start, end) <= 380:
                out[end] = val
    return out


def ratio_series(facts: dict, spec: dict) -> dict[str, float]:
    """Annualized ratios: prefer the longest period ending on each date (FY over YTD)."""
    out: dict[str, tuple[int, float]] = {}
    for tag in spec["tags"]:
        for (start, end), val in _latest_by_period(_raw(facts, tag, spec["unit"])).items():
            if not start:
                continue
            length = _days(start, end)
            if length >= 80 and (end not in out or length > out[end][0]):
                out[end] = (length, val)
    return {k: v for k, (_, v) in out.items()}


def quarter_ends(nav: dict[str, float]) -> list[str]:
    """Reporting dates: month-end dates with a NAV per share, at least ~2 months apart."""
    ends = sorted(d for d in nav if _date(d).day >= 28 or _date(d).month == 2 and _date(d).day >= 27)
    out: list[str] = []
    for d in ends:
        if not out or _days(out[-1], d) >= 60:
            out.append(d)
    # keep only the latest unbroken run: a hole in the XBRL history would
    # otherwise squeeze years together on a quarterly axis
    for k in range(len(out) - 1, 0, -1):
        if _days(out[k - 1], out[k]) > 130:
            return out[k:]
    return out


def extract(facts: dict, splits: list[tuple[str, float]] | None = None) -> dict:
    """All configured series for one company: {'quarters': [...], 'series': {metric: {end: val}}}."""
    splits = splits or []
    series: dict[str, dict[str, float]] = {}
    for name, spec in TAGS["instant"].items():
        series[name] = instant_series(facts, spec, splits)
    nav_all = dict(sorted(series["nav_per_share"].items()))  # incl. annual points before any gap
    qends = quarter_ends(series["nav_per_share"])
    for name, spec in TAGS["duration"].items():
        series[name] = quarterly_series(facts, spec, qends, splits)
    for name, spec in TAGS["ratio"].items():
        series[name] = ratio_series(facts, spec)
    series = {k: {d: v for d, v in s.items() if d in qends} for k, s in series.items()}
    annual = {name: annual_series(facts, TAGS["duration"][name], splits)
              for name in ("total_income", "nii", "pik_interest", "pik_dividend", "interest_expense")}
    return {"quarters": qends, "series": series, "annual": annual, "nav_all": nav_all}


if __name__ == "__main__":
    import sys

    cik = int(sys.argv[1]) if len(sys.argv) > 1 else 1287750
    data = extract(sec.company_facts(cik, max_age_hours=24))
    for q in data["quarters"][-8:]:
        row = {k: data["series"][k].get(q) for k in ("nav_per_share", "nii_per_share", "dist_per_share", "nii", "debt", "net_assets")}
        print(q, row)
