"""Portfolio composition and non-accruals from each BDC's Schedule of Investments.

Uses edgartools on the XBRL of the 10-Q/10-K filings themselves (newer than the
monthly SEC BDC Data Sets). Results are cached per accession number, so a
filing is parsed once; the first run reads the last few filings per BDC to
seed the non-accrual history.
"""

from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from functools import partial

import yaml

from . import sec

CACHE = sec.CACHE / "portfolio"
HISTORY_FILINGS = 4  # one year; raise with --portfolio-history to seed more
CACHE_VERSION = 2
RELIABLE_COVERAGE = (0.6, 1.25)  # holdings total / balance-sheet investments
MIN_TYPED_SHARE = 0.8  # first-lien share only when >= 80% of the portfolio has a known type
GROUPS = yaml.safe_load((sec.ROOT / "config" / "investment_types.yaml").read_text())["groups"]
_RULES = [(g["key"], [re.compile(p, re.I) for p in g["patterns"]]) for g in GROUPS]
log = logging.getLogger(__name__)


def type_group(name: str | None) -> str:
    text = (name or "").strip()
    for key, patterns in _RULES:
        if any(p.search(text) for p in patterns):
            return key
    return "other"


def _f(x) -> float:
    return float(x) if x is not None else 0.0


def _company_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())[:40]


def analyze_filing(filing) -> dict:
    """Parse one filing: raw holding rows plus the non-accrual list.

    Rows stay raw in the cache so changes to config/investment_types.yaml apply
    without re-downloading anything. The XBRL is downloaded once and shared.
    """
    from edgar.bdc.investments import PortfolioInvestments
    from edgar.bdc.nonaccrual import _extract_nonaccrual_from_xbrl

    out: dict = {"v": CACHE_VERSION, "accession": filing.accession_no, "form": filing.form,
                 "filed": str(filing.filing_date), "period": str(filing.period_of_report)}
    xbrl = filing.xbrl()  # network errors propagate so the filing is retried next time
    if xbrl is None:
        return out

    try:
        inv = PortfolioInvestments.from_xbrl(xbrl)
        out["rows"] = [
            [i.company_name, i.investment_type, i.industry, round(_f(i.fair_value)), round(_f(i.cost)),
             float(i.interest_rate) if i.interest_rate is not None else None,
             float(i.spread) if i.spread is not None else None,
             float(i.pik_rate) if i.pik_rate else 0.0, bool(i.is_debt)]
            for i in inv
        ]
        out["reported_total_fv"] = _f(inv.reported_total_fair_value) or None
    except Exception as exc:
        log.warning("%s: holdings parse failed: %s", filing.accession_no, exc)

    try:
        na = _extract_nonaccrual_from_xbrl(xbrl, period=out["period"], cik=filing.cik,
                                           entity_name=filing.company, accession_number=filing.accession_no)
        names = defaultdict(lambda: {"fv": 0.0, "cost": 0.0})
        for item in na.investments:
            agg = names[item.company_name]
            agg["fv"] += _f(item.fair_value)
            agg["cost"] += _f(item.cost)
        out["nonaccrual"] = {
            "fv": _f(na.nonaccrual_fair_value),
            "cost": sum(v["cost"] for v in names.values()),
            "count": len(names),
            "portfolio_fv": _f(na.total_portfolio_fair_value) or None,
            "method": na.extraction_method,
            "names": sorted(({"name": k, **v} for k, v in names.items()), key=lambda r: -r["cost"])[:15],
        }
    except Exception as exc:
        log.warning("%s: non-accrual extraction failed: %s", filing.accession_no, exc)
    return out


ROW_FIELDS = ("company", "type", "industry", "fv", "cost", "rate", "spread", "pik", "debt")


def summarize_holdings(rows: list[dict], total: float) -> dict:
    if total <= 0:
        return {}
    by_type: dict[str, float] = defaultdict(float)
    by_industry: dict[str, float] = defaultdict(float)
    by_company: dict[str, list] = {}
    debt_fv = floating_fv = rate_w = rate_fv = pik_fv = 0.0
    for r in rows:
        if r["fv"] <= 0:
            continue
        by_type[type_group(r["type"])] += r["fv"]
        by_industry[r["industry"] or "Неуточнен"] += r["fv"]
        key = _company_key(r["company"])
        if key not in by_company:
            by_company[key] = [r["company"], 0.0]
        by_company[key][1] += r["fv"]
        if r["debt"]:
            debt_fv += r["fv"]
            if r["spread"]:
                floating_fv += r["fv"]
            if r["rate"] and 0 < r["rate"] < 0.4:
                rate_w += r["rate"] * r["fv"]
                rate_fv += r["fv"]
        if r["pik"]:
            pik_fv += r["fv"]
    top = sorted(by_company.values(), key=lambda x: -x[1])
    industries = sorted(by_industry.items(), key=lambda x: -x[1])
    return {
        "total_fv": total,
        "n_companies": len(by_company),
        "n_investments": len(rows),
        "by_type": {k: v / total for k, v in sorted(by_type.items(), key=lambda x: -x[1])},
        "industries": [[name, v / total] for name, v in industries[:12]],
        "top_industry": industries[0][1] / total if industries else None,
        "top10": [[name, v / total] for name, v in top[:10]],
        "top10_pct": sum(v for _, v in top[:10]) / total,
        "floating": floating_fv / debt_fv if debt_fv else None,
        "debt_yield": rate_w / rate_fv if rate_fv else None,
        "pik_exposure": pik_fv / total,
    }


def _cached(accession: str, need_rows: bool) -> dict | None:
    """Cached filing; older cache entries without raw rows still serve the non-accrual history."""
    path = CACHE / f"{accession}.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    if need_rows and data.get("v") != CACHE_VERSION:
        return None
    return data


def history(cik: int, limit: int = HISTORY_FILINGS) -> list[dict]:
    """Parsed data for the latest `limit` periodic filings, newest first.

    Holdings are needed only for the newest filing; older ones feed the
    non-accrual trend. Network errors skip the filing (it is retried on the
    next build) instead of failing the whole run.
    """
    from edgar import Company

    try:
        company = Company(cik)
        filings = []
        for form in ("10-Q", "10-K"):
            filings.extend(company.get_filings(form=form, amendments=False).head(limit))
        filings = sorted(filings, key=lambda f: str(f.period_of_report), reverse=True)[:limit]
    except Exception as exc:
        log.warning("CIK %s: cannot list filings: %s", cik, exc)
        return []
    out = []
    for n, f in enumerate(filings):
        data = _cached(f.accession_no, need_rows=n == 0)
        if data is None:
            try:
                data = analyze_filing(f)
            except Exception as exc:
                log.warning("CIK %s %s: skipped: %s", cik, f.accession_no, exc)
                continue
            if "rows" in data or "nonaccrual" in data:
                CACHE.mkdir(parents=True, exist_ok=True)
                (CACHE / f"{f.accession_no}.json").write_text(json.dumps(data))
        out.append(data)
    return out


def _init_worker() -> None:
    from edgar import set_identity

    logging.getLogger("edgar").setLevel(logging.ERROR)
    set_identity(sec.user_agent())


def prefetch(ciks: list[int], limit: int = HISTORY_FILINGS, workers: int = 6) -> dict[int, list[dict]]:
    """XBRL parsing is CPU-heavy, so filings are parsed in separate processes."""
    with ProcessPoolExecutor(workers, initializer=_init_worker) as pool:
        results = list(pool.map(partial(history, limit=limit), ciks))
    return dict(zip(ciks, results))


def attach(company: dict, filings: list[dict]) -> None:
    """Add 'portfolio' plus non-accrual series/snapshot fields to a built company dict."""
    latest = next((f for f in filings if f.get("rows")), None)
    if latest:
        rows = [dict(zip(ROW_FIELDS, r)) for r in latest["rows"]]
        latest = {**latest, "holdings": summarize_holdings(rows, sum(r["fv"] for r in rows if r["fv"] > 0))}
        if not latest["holdings"]:
            latest = None
    snap = company["latest"]
    q = company["q"]
    quarters = company["quarters"]
    fv_by_q = dict(zip(quarters, q["fv"]))
    cost_by_q = dict(zip(quarters, q["cost"]))

    na_fv, na_cost = {}, {}
    for f in filings:
        na = f.get("nonaccrual")
        if not na or f["period"] not in fv_by_q:
            continue
        # a custom-concept result is a rate applied to edgartools' own portfolio total
        if na.get("method") == "custom_concept" and na.get("portfolio_fv"):
            port = na["portfolio_fv"]
        else:
            port = fv_by_q.get(f["period"]) or na.get("portfolio_fv")
        cost = cost_by_q.get(f["period"])
        na_fv[f["period"]] = na["fv"] / port if port else None
        na_cost[f["period"]] = na["cost"] / cost if cost else None
    q["nonaccrual_fv"] = [na_fv.get(d) for d in quarters]
    q["nonaccrual_cost"] = [na_cost.get(d) for d in quarters]

    newest = next((f for f in filings if f.get("nonaccrual")), None)
    if newest and newest["period"] in na_fv:
        snap["nonaccrual_fv"] = na_fv[newest["period"]]
        snap["nonaccrual_cost"] = na_cost[newest["period"]]
        snap["nonaccrual_count"] = newest["nonaccrual"]["count"]
        snap["nonaccrual_period"] = newest["period"]
    if latest:
        h = latest["holdings"]
        balance_fv = fv_by_q.get(latest["period"])
        coverage = h["total_fv"] / balance_fv if balance_fv else None
        # sums far from the balance sheet mean duplicated or missing rows: show, but do not score
        reliable = coverage is not None and RELIABLE_COVERAGE[0] <= coverage <= RELIABLE_COVERAGE[1]
        typed = 1 - h["by_type"].get("other", 0)
        if reliable:
            snap["top10"] = h["top10_pct"]
            snap["n_companies"] = h["n_companies"]
            snap["floating"] = h["floating"]
            snap["top_industry"] = h["top_industry"]
            if typed >= MIN_TYPED_SHARE:
                snap["first_lien"] = h["by_type"].get("first_lien", 0.0)
        company["portfolio"] = {
            "period": latest["period"],
            "form": latest["form"],
            **h,
            "coverage": coverage,
            "reliable": reliable,
            "typed_share": typed,
            "nonaccrual_names": (newest or {}).get("nonaccrual", {}).get("names", []),
            "type_labels": {g["key"]: g["label"] for g in GROUPS} | {"other": "Неуточнен тип"},
        }
