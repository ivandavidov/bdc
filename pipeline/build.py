"""Build every JSON file the site reads: python -m pipeline.build

Steps: universe -> per company (SEC facts, prices, dividends, metrics,
portfolio) -> scores -> sector aggregates -> change log -> docs/data.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import math
from statistics import median

from . import dividends, events, facts, health, holders, metrics, portfolio, prices, scoring, sec, universe

DATA = sec.ROOT / "docs" / "data"
STATE = sec.CACHE / "state.json"
log = logging.getLogger("build")


def _round(x, digits=6):
    if isinstance(x, float):
        if math.isnan(x) or math.isinf(x):
            return None
        return float(f"{x:.{digits}g}")
    if isinstance(x, dict):
        return {k: _round(v, digits) for k, v in x.items()}
    if isinstance(x, list):
        return [_round(v, digits) for v in x]
    return x


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_round(payload), ensure_ascii=False, separators=(",", ":")))


def _filings(subs: dict, cik: int) -> list[dict]:
    recent = subs.get("filings", {}).get("recent", {})
    rows = zip(recent.get("form", []), recent.get("filingDate", []), recent.get("accessionNumber", []),
               recent.get("primaryDocument", []), recent.get("reportDate", []))
    out = []
    for form, date, acc, doc, period in rows:
        if form in ("10-K", "10-Q", "8-K", "10-K/A", "10-Q/A"):
            url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{doc}"
            out.append({"form": form, "date": date, "period": period or None, "url": url})
    periodic = [f for f in out if f["form"].startswith("10-")][:8]
    current = [f for f in out if f["form"] == "8-K"][:6]
    return sorted(periodic + current, key=lambda f: f["date"], reverse=True)


def _latest_periodic(subs: dict) -> str | None:
    recent = subs.get("filings", {}).get("recent", {})
    for form, acc in zip(recent.get("form", []), recent.get("accessionNumber", [])):
        if form.startswith(("10-K", "10-Q")):
            return acc
    return None


def build_company(ticker: str, meta: dict, state: dict, today: dt.date) -> dict | None:
    cik = meta["cik"]
    subs = sec.submissions(cik) or {}
    latest = _latest_periodic(subs)
    fresh = state.get(str(cik)) != latest
    company_facts = sec.company_facts(cik, max_age_hours=0 if fresh else 24 * 30)
    if not company_facts:
        log.warning("%s: no XBRL facts", ticker)
        return None
    state[str(cik)] = latest

    price = prices.get(ticker)
    splits = [(d, r) for d, r in (price or {}).get("splits", [])]
    extracted = facts.extract(company_facts, splits)
    if not extracted["quarters"]:
        log.warning("%s: no quarterly NAV history", ticker)
        return None
    classified = dividends.classify((price or {}).get("dividends", []))
    q = metrics.quarterly(extracted, classified)
    weekly = metrics.weekly_p_nav(price or {}, extracted["nav_all"])
    snap = metrics.snapshot(meta, extracted, q, price, classified, weekly, today)

    owners = holders.get(ticker)
    if owners:
        snap["insiders_pct"] = owners.get("insiders")
        snap["institutions_pct"] = owners.get("institutions")
    keep = slice(-metrics.HISTORY_QUARTERS, None)
    cut_from = (today - dt.timedelta(days=3650)).isoformat()
    return {
        "ticker": ticker,
        "name": meta["name"],
        "cik": cik,
        "exchange": meta.get("exchange"),
        "manager": meta.get("manager"),
        "fye": meta.get("fye"),
        "file_number": meta.get("file_number"),
        "note": meta.get("note"),
        "edgar_url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=10-&dateb=&owner=include&count=40",
        "price": (price or {}).get("last"),
        "price_stale": bool((price or {}).get("stale")),
        "latest": snap,
        "quarters": extracted["quarters"][keep],
        "q": {k: v[keep] for k, v in q.items()},
        "weekly": weekly,
        "dividends": [p for p in classified if p["date"] >= cut_from],
        "cuts": dividends.cuts(classified, today - dt.timedelta(days=3650)),
        "filings": _filings(subs, cik),
        "holders": owners,
        "splits": splits,
    }


SUMMARY_FIELDS = [
    "price", "price_date", "nav_ps", "nav_date", "p_nav", "p_nav_avg_3y", "p_nav_z", "yield_fwd", "yield_ttm",
    "coverage_q", "coverage_ttm", "nav_chg_1y", "nav_chg_3y", "nav_tr_1y", "nav_tr_3y", "nav_tr_5y",
    "de", "net_de", "asset_coverage", "fv_cost", "pik_pct_ttm", "opex_ratio", "managed", "market_cap",
    "net_assets", "investments_fv", "tsr_1y", "tsr_3y", "cuts_5y", "nav_cagr_long", "nav_long_years", "div_change_1y", "data_age_days",
    "nonaccrual_fv", "nonaccrual_cost", "first_lien", "top10", "n_companies", "floating", "div_suspended",
    "div_run_rate", "nonaccrual_period",
]


def summarize(companies: list[dict]) -> list[dict]:
    rows = []
    for c in companies:
        snap = c["latest"]
        row = {"ticker": c["ticker"], "name": c["name"], "manager": c.get("manager")}
        row.update({k: snap.get(k) for k in SUMMARY_FIELDS})
        row.update({k: c["score"].get(k) for k in ("total", "light", "valuation", "flags", "categories", "incomplete")})
        rows.append(row)
    return sorted(rows, key=lambda r: (r["total"] is None or bool(r["incomplete"]), -(r["total"] or 0)))


def sector(companies: list[dict]) -> dict:
    """Cross-sectional medians by calendar quarter plus portfolio health across all BDCs."""
    by_quarter: dict[str, dict[str, list]] = {}
    for c in companies:
        for i, qd in enumerate(c["quarters"]):
            key = f"{qd[:4]}Q{(int(qd[5:7]) - 1) // 3 + 1}"
            bucket = by_quarter.setdefault(key, {})
            for name in ("econ_return", "de", "coverage", "pik_pct", "fv_cost", "nonaccrual_cost"):
                v = c["q"][name][i]
                if v is not None:
                    bucket.setdefault(name, []).append(v)
            na = c["q"]["nonaccrual_fv"][i] if "nonaccrual_fv" in c["q"] else None
            if na is not None:
                bucket.setdefault("nonaccrual_fv", []).append(na)
    quarters = sorted(by_quarter)[-metrics.HISTORY_QUARTERS:]
    med = {
        name: [median(by_quarter[k][name]) if len(by_quarter[k].get(name, [])) >= 5 else None for k in quarters]
        for name in ("econ_return", "de", "coverage", "pik_pct", "fv_cost", "nonaccrual_fv", "nonaccrual_cost")
    }
    med["count"] = [max((len(v) for v in by_quarter[k].values()), default=0) for k in quarters]

    weekly: dict[str, list] = {}
    for c in companies:
        for d, v in zip(c["weekly"]["dates"], c["weekly"]["p_nav"]):
            if v:
                weekly.setdefault(d, []).append(v)
    wdates = sorted(d for d, v in weekly.items() if len(v) >= 10)
    return {
        "quarters": quarters,
        "median": med,
        "p_nav": {"dates": wdates, "median": [median(weekly[d]) for d in wdates]},
        "health": health.build(companies),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-universe", action="store_true", help="use config/universe.yaml as is")
    parser.add_argument("--only", nargs="*", help="build just these tickers (for debugging)")
    parser.add_argument("--portfolio-history", type=int, default=portfolio.HISTORY_FILINGS,
                        help="how many recent 10-Q/10-K filings to parse for the non-accrual history")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)

    today = dt.date.today()
    active = universe.load() if args.skip_universe else universe.refresh()
    active = {t: m for t, m in active.items() if m.get("active", True) and not m.get("exclude")}
    if args.only:
        active = {t: m for t, m in active.items() if t in args.only}
    state = json.loads(STATE.read_text()) if STATE.exists() else {}

    companies = []
    for ticker in sorted(active):
        log.info("building %s", ticker)
        company = build_company(ticker, active[ticker], state, today)
        if company:
            companies.append(company)

    log.info("reading schedules of investments")
    holdings = portfolio.prefetch([c["cik"] for c in companies], limit=args.portfolio_history)
    for c in companies:
        portfolio.attach(c, holdings.get(c["cik"], []))

    scoring.score_all(companies)
    sector_data = sector(companies)
    scoring.attach_percentiles(companies)

    previous = json.loads((DATA / "summary.json").read_text()) if (DATA / "summary.json").exists() else None
    summary = summarize(companies)
    log_entries = events.update(previous, summary, companies, today)

    for c in companies:
        c["events"] = [e for e in log_entries if e["ticker"] == c["ticker"]][:20]
        _write(DATA / "companies" / f"{c['ticker']}.json", c)
    if not args.only:
        _write(DATA / "summary.json", {"generated": today.isoformat(), "companies": summary})
        _write(DATA / "sector.json", sector_data)
        _write(DATA / "meta.json", {
            "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
            "count": len(companies),
            "scoring": scoring.public_config(),
        })
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state))
    log.info("done: %d companies", len(companies))


if __name__ == "__main__":
    main()
