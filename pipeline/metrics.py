"""Derived metrics for one BDC: quarterly series plus a latest snapshot."""

from __future__ import annotations

import datetime as dt
from statistics import mean, pstdev

from . import dividends as divs

HISTORY_QUARTERS = 40  # ten years of quarterly history in the output
WEEKLY_START = "2014-01-01"


def _div(a, b):
    if a is None or b in (None, 0):
        return None
    return a / b


def _sum(values):
    return None if any(v is None for v in values) or not values else sum(values)


def _chain(returns):
    if not returns or any(r is None for r in returns):
        return None
    total = 1.0
    for r in returns:
        total *= 1 + r
    return total - 1


def _annualize(total, years):
    if total is None or total <= -1:
        return None
    return (1 + total) ** (1 / years) - 1


def _latest_fiscal_year(extracted: dict, today: dt.date) -> str | None:
    """End date of the latest full fiscal year with total income, if within ~18 months."""
    ends = sorted(extracted.get("annual", {}).get("total_income", {}))
    if ends and (today - dt.date.fromisoformat(ends[-1])).days <= 550:
        return ends[-1]
    return None


def long_nav_change(nav_all: dict[str, float], nav_date: str | None) -> tuple[float | None, float | None]:
    """Annualized NAV/share change over ~10 years (at least 5), from all reported NAV points.

    Quarterly XBRL history can be short (PSEC tagged only annual NAV before
    2021), so annual points fill in the long view of capital erosion.
    """
    if not nav_date or nav_date not in nav_all:
        return None, None
    end = dt.date.fromisoformat(nav_date)
    points = [(dt.date.fromisoformat(d), v) for d, v in nav_all.items() if v and d < nav_date]
    target = end - dt.timedelta(days=3652)
    eligible = [(d, v) for d, v in points if (end - d).days >= 5 * 365 - 60]
    if not eligible:
        return None, None
    start, base = min(eligible, key=lambda p: abs((p[0] - target).days))
    years = (end - start).days / 365.25
    return (nav_all[nav_date] / base) ** (1 / years) - 1, round(years, 1)


def quarterly(extracted: dict, classified: list[dict]) -> dict[str, list]:
    """Aligned quarterly arrays; None where a value is unavailable."""
    qs = extracted["quarters"]
    s = extracted["series"]
    get = lambda name: [s[name].get(q) for q in qs]  # noqa: E731

    nav, nii_ps, dist_ps = get("nav_per_share"), get("nii_per_share"), get("dist_per_share")
    net_assets, debt, cash = get("net_assets"), get("debt"), get("cash")
    liabilities, fv, cost = get("liabilities"), get("investments_fv"), get("investments_cost")
    total_income, nii, interest = get("total_income"), get("nii"), get("interest_expense")
    pik_i, pik_d = get("pik_interest"), get("pik_dividend")
    reported_cov = get("asset_coverage")
    shares, pref, pref_div = get("shares"), get("preferred"), get("pref_dividends")

    # BDC income statements report NII before preferred dividends; the common
    # shareholder only gets what is left (PSEC: ~$0.05/share per quarter)
    nii_ps = [n - pd / sh if None not in (n, pd, sh) and sh else n for n, pd, sh in zip(nii_ps, pref_div, shares)]
    nii_before_pref = nii  # operating costs come out of NII before preferred dividends
    nii = [n - pd if n is not None and pd is not None else n for n, pd in zip(nii, pref_div)]

    reg_div = [divs.quarterly_regular(classified, q) for q in qs]
    out: dict[str, list] = {
        "nav_ps": nav,
        "nii_ps": nii_ps,
        "dist_ps": dist_ps,
        "reg_div": reg_div,
        "net_assets": net_assets,
        "fv": fv,
        "cost": cost,
        "debt": debt,
        "total_income": total_income,
        "nii": nii,
        "shares": shares,
        "preferred": pref,
        "pref_div": pref_div,
        "mgmt_fee": get("mgmt_fee"),
        "incentive_fee": get("incentive_fee"),
        "expense_ratio": get("expense_ratio"),
    }
    out["coverage"] = [_div(n, d) for n, d in zip(nii_ps, reg_div)]

    de, de_approx, net_de, acr = [], [], [], []
    for d, na, c, liab, rep, pf in zip(debt, net_assets, cash, liabilities, reported_cov, pref):
        approx = d is None or (liab is not None and d > liab * 1.02)
        base = liab if approx else d
        # preferred stock ranks ahead of common shareholders, so it counts as leverage
        pf = pf if pf and na and pf > 0.005 * na else 0.0
        senior = base + pf if base is not None else None
        de.append(_div(senior, na))
        de_approx.append(approx and base is not None)
        net_de.append(_div(senior - (c or 0), na) if senior is not None else None)
        if pf or rep is None:
            acr.append(_div((na or 0) + senior, senior) if senior else None)
        else:
            acr.append(rep)
    out.update(de=de, de_approx=de_approx, net_de=net_de, asset_coverage=acr)

    out["fv_cost"] = [_div(a, b) for a, b in zip(fv, cost)]
    pik = [(a or 0) + (b or 0) if (a is not None or b is not None) else None for a, b in zip(pik_i, pik_d)]
    out["pik"] = pik
    out["pik_pct"] = [_div(p, t) for p, t in zip(pik, total_income)]
    out["opex"] = [
        t - n - (i or 0) if t is not None and n is not None and i is not None else None
        for t, n, i in zip(total_income, nii_before_pref, interest)
    ]

    econ, roe = [None], [None]
    for k in range(1, len(qs)):
        prev, cur = nav[k - 1], nav[k]
        paid = dist_ps[k] if dist_ps[k] is not None else reg_div[k]
        econ.append((cur - prev + paid) / prev if None not in (prev, cur, paid) and prev else None)
        roe.append(nii_ps[k] * 4 / prev if nii_ps[k] is not None and prev else None)
    out["econ_return"] = econ
    out["nii_roe"] = roe
    return out


def weekly_p_nav(price: dict, nav_points: dict[str, float]) -> dict[str, list]:
    """Weekly close and P/NAV using the latest reported NAV at each date."""
    pairs = [(d, v) for d, v in sorted(nav_points.items()) if v]
    dates, close, navs, p_nav = [], [], [], []
    k = -1
    for d, c, _ in price.get("weekly", []):
        if d < WEEKLY_START:
            continue
        while k + 1 < len(pairs) and pairs[k + 1][0] <= d:
            k += 1
        n = pairs[k][1] if k >= 0 else None
        dates.append(d)
        close.append(c)
        navs.append(n)
        p_nav.append(round(c / n, 4) if n else None)
    return {"dates": dates, "close": close, "nav": navs, "p_nav": p_nav}


def snapshot(meta: dict, extracted: dict, q: dict, price: dict | None, classified: list[dict],
             weekly: dict, today: dt.date) -> dict:
    qs = extracted["quarters"]
    n = len(qs)

    def last(name, back=0):
        idx = n - 1 - back
        return q[name][idx] if 0 <= idx < n else None

    def last_valid(name):
        for k in range(n - 1, -1, -1):
            if q[name][k] is not None:
                return q[name][k], qs[k]
        return None, None

    def trailing(name, count=4):
        return _sum(q[name][-count:]) if n >= count else None

    snap: dict = {"period": qs[-1] if qs else None}
    nav, nav_date = last_valid("nav_ps")
    snap["nav_ps"], snap["nav_date"] = nav, nav_date
    snap["data_age_days"] = (today - dt.date.fromisoformat(nav_date)).days if nav_date else None

    close = price["last"]["close"] if price else None
    snap["price"] = close
    snap["price_date"] = price["last"]["date"] if price else None
    snap["p_nav"] = _div(close, nav)
    pn = [v for v in weekly["p_nav"][-156:] if v]
    if len(pn) >= 52:
        snap["p_nav_avg_3y"] = mean(pn)
        sd = pstdev(pn)
        snap["p_nav_z"] = (snap["p_nav"] - snap["p_nav_avg_3y"]) / sd if sd and snap["p_nav"] else None

    rr = divs.run_rate(classified, today)
    snap["div_run_rate"] = rr
    snap["div_suspended"] = rr == 0.0
    snap["yield_fwd"] = _div(rr, close)
    reg_ttm, spec_ttm = divs.trailing_total(classified, today)
    snap["yield_ttm"] = _div(reg_ttm + spec_ttm, close)
    snap["special_ttm"] = spec_ttm
    regs = divs.regular_payments(classified)
    snap["div_freq"] = regs[-1]["freq"] if regs else None
    for years in (1, 3):
        past = divs.run_rate(classified, today - dt.timedelta(days=365 * years))
        snap[f"div_change_{years}y"] = _div(rr, past) - 1 if rr is not None and past else None
    cut_events = divs.cuts(classified, today - dt.timedelta(days=5 * 365))
    snap["cuts_5y"] = len(cut_events)
    snap["cut_12m"] = any(dt.date.fromisoformat(c["date"]) > today - dt.timedelta(days=365) for c in cut_events)

    snap["coverage_q"] = last("coverage")
    nii4, div4 = trailing("nii_ps"), trailing("reg_div")
    snap["coverage_ttm"] = _div(nii4, div4)
    snap["coverage_below_90_2q"] = all(
        c is not None and c < 0.9 for c in q["coverage"][-2:]
    ) if n >= 2 else False
    snap["nii_ps_ttm"] = nii4
    snap["nii_roe_ttm"] = _div(nii4, last("nav_ps", 4))

    for label, back in (("1y", 4), ("3y", 12), ("5y", 20)):
        snap[f"nav_chg_{label}"] = _div(nav, last("nav_ps", back)) - 1 if last("nav_ps", back) and nav else None
    snap["nav_tr_1y"] = _chain(q["econ_return"][-4:]) if n > 4 else None
    snap["nav_tr_3y"] = _annualize(_chain(q["econ_return"][-12:]), 3) if n > 12 else None
    snap["nav_tr_5y"] = _annualize(_chain(q["econ_return"][-20:]), 5) if n > 20 else None
    snap["nav_cagr_long"], snap["nav_long_years"] = long_nav_change(extracted.get("nav_all", {}), nav_date)
    navs5 = [v for v in q["nav_ps"][-21:] if v]
    peak, dd = None, 0.0
    for v in navs5:
        peak = v if peak is None or v > peak else peak
        dd = min(dd, v / peak - 1)
    snap["nav_drawdown_5y"] = dd if navs5 else None

    snap["de"], snap["de_approx"] = last("de"), last("de_approx")
    snap["net_de"] = last("net_de")
    snap["asset_coverage"] = last("asset_coverage")
    snap["fv_cost"] = last("fv_cost")
    snap["pik_pct_ttm"] = _div(trailing("pik"), trailing("total_income"))
    fy = _latest_fiscal_year(extracted, today)
    if snap["pik_pct_ttm"] is None and fy:
        pik = [extracted["annual"][k].get(fy) for k in ("pik_interest", "pik_dividend")]
        if any(v is not None for v in pik):
            snap["pik_pct_ttm"] = _div(sum(v or 0 for v in pik), extracted["annual"]["total_income"].get(fy))

    avg_na = mean([v for v in q["net_assets"][-5:] if v]) if any(q["net_assets"][-5:]) else None
    snap["opex_ratio"] = _div(trailing("opex"), avg_na)
    if snap["opex_ratio"] is None and fy:
        a = extracted["annual"]
        parts = [a[k].get(fy) for k in ("total_income", "nii", "interest_expense")]
        if None not in parts:
            snap["opex_ratio"] = _div(parts[0] - parts[1] - parts[2], avg_na)
    exp, _ = last_valid("expense_ratio")
    snap["expense_ratio_reported"] = exp

    fees = trailing("mgmt_fee")
    managed = meta.get("managed", "auto")
    if managed == "auto":
        # a management fee in the income statement means an external adviser;
        # without the tag we cannot tell, so leave it unknown
        managed = "external" if fees else None
    snap["managed"] = managed

    shares, _ = last_valid("shares")
    snap["market_cap"] = close * shares if close and shares else None
    snap["net_assets"], _ = last_valid("net_assets")
    snap["investments_fv"], _ = last_valid("fv")
    if price:
        snap.update({f"tsr_{k}": v for k, v in price["returns"].items()})
        snap["avg_dollar_volume"] = price["last"]["avg_dollar_volume_3m"]
        snap["price_stale"] = bool(price.get("stale"))
    return snap
