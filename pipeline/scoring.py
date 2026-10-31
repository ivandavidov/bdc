"""Quality score (0–100), traffic light, red flags and valuation label."""

from __future__ import annotations

import yaml

from . import sec

CONFIG = yaml.safe_load((sec.ROOT / "config" / "scoring.yaml").read_text())

# For percentiles: +1 when higher is better, -1 when lower is better.
DIRECTION = {
    "coverage_ttm": 1, "coverage_q": 1, "cuts_5y": -1, "pik_pct_ttm": -1, "nav_tr_3y": 1, "nav_tr_5y": 1,
    "nav_chg_1y": 1, "nav_chg_3y": 1, "nav_cagr_long": 1, "nav_tr_1y": 1, "nonaccrual_fv": -1, "nonaccrual_cost": -1, "fv_cost": 1,
    "first_lien": 1, "top10": -1, "net_de": -1, "de": -1, "asset_coverage": 1, "opex_ratio": -1,
    "yield_fwd": 1, "p_nav": -1, "nii_roe_ttm": 1, "tsr_1y": 1, "tsr_3y": 1, "market_cap": 1,
}


def interpolate(value: float, points: list[list[float]]) -> float:
    if value <= points[0][0]:
        return points[0][1]
    if value >= points[-1][0]:
        return points[-1][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x0 <= value <= x1:
            return y0 + (y1 - y0) * (value - x0) / (x1 - x0)
    return points[-1][1]


def _metric_value(name: str, snap: dict):
    if name == "internal":
        return {"internal": 1, "external": 0}.get(snap.get("managed"))
    return snap.get(name)


def flags_for(snap: dict) -> list[str]:
    out = []
    if snap.get("coverage_below_90_2q"):
        out.append("coverage_below_90_2q")
    if (snap.get("nonaccrual_cost") or 0) > 0.08:
        out.append("nonaccrual_high")
    if snap.get("nav_chg_1y") is not None and snap["nav_chg_1y"] < -0.10:
        out.append("nav_drop")
    if snap.get("asset_coverage") is not None and snap["asset_coverage"] < 1.70:
        out.append("low_asset_coverage")
    if snap.get("div_suspended"):
        out.append("suspended")
    elif snap.get("cut_12m"):
        out.append("cut_12m")
    return out


def valuation(snap: dict) -> str | None:
    z = snap.get("p_nav_z")
    if z is None:
        return None
    cfg = CONFIG["valuation"]
    if z <= cfg["cheap_z"]:
        return "cheap"
    if z >= cfg["expensive_z"]:
        return "expensive"
    return "fair"


def score(snap: dict) -> dict:
    categories = {}
    total_w = total = 0.0
    possible_w = available_w = 0.0
    for key, cat in CONFIG["categories"].items():
        cat_w = cat_score = 0.0
        details = {}
        for mname, m in cat["metrics"].items():
            value = _metric_value(mname, snap)
            possible_w += cat["weight"] * m["weight"]
            if value is None:
                details[mname] = None
                continue
            pts = interpolate(value, m["points"])
            details[mname] = round(pts, 1)
            cat_w += m["weight"]
            cat_score += pts * m["weight"]
            available_w += cat["weight"] * m["weight"]
        cat_total = cat_score / cat_w if cat_w else None
        categories[key] = {"score": round(cat_total, 1) if cat_total is not None else None, "metrics": details}
        if cat_total is not None:
            total += cat_total * cat["weight"]
            total_w += cat["weight"]

    value = round(total / total_w, 1) if total_w else None
    th = CONFIG["thresholds"]
    light = None
    if value is not None:
        shown = round(value)  # the light must agree with the whole number the site displays
        light = "green" if shown >= th["green"] else "yellow" if shown >= th["yellow"] else "red"
    flags = flags_for(snap)
    incomplete = (available_w / possible_w) < th["incomplete"] if possible_w else True
    if incomplete:
        light = None  # too little data for a verdict; the number is still shown with a badge
    crit = CONFIG.get("critical", {})
    weak = [k for k in crit.get("categories", [])
            if categories[k]["score"] is not None and categories[k]["score"] < crit.get("floor", 0)]
    if light and weak:
        light = "red"
    elif light and len(flags) >= 3:
        light = "red"
    elif light == "green" and flags:
        light = "yellow"
    return {
        "total": value,
        "light": light,
        "categories": {k: v["score"] for k, v in categories.items()},
        "details": categories,
        "flags": flags,
        "weak": weak,
        "valuation": valuation(snap),
        "coverage": round(available_w / possible_w, 2) if possible_w else 0,
        "incomplete": incomplete,
    }


def score_all(companies: list[dict]) -> None:
    for c in companies:
        c["score"] = score(c["latest"])


def attach_percentiles(companies: list[dict]) -> None:
    """Percentile (0–100, higher = better) of each metric versus all companies."""
    for name, direction in DIRECTION.items():
        values = [(c["ticker"], c["latest"].get(name)) for c in companies]
        values = [(t, v) for t, v in values if v is not None]
        if len(values) < 5:
            continue
        ordered = sorted(v * direction for _, v in values)
        for c in companies:
            v = c["latest"].get(name)
            if v is None:
                continue
            below = sum(1 for x in ordered if x < v * direction)
            equal = sum(1 for x in ordered if x == v * direction)
            c.setdefault("percentiles", {})[name] = round(100 * (below + 0.5 * equal) / len(ordered))


def public_config() -> dict:
    """The parts of the methodology the site displays."""
    return {
        "thresholds": CONFIG["thresholds"],
        "categories": {
            k: {
                "label": v["label"],
                "weight": v["weight"],
                "metrics": {m: {"label": d["label"], "weight": d["weight"], "points": d["points"]} for m, d in v["metrics"].items()},
            }
            for k, v in CONFIG["categories"].items()
        },
        "flags": CONFIG["flags"],
        "critical": CONFIG.get("critical", {}),
        "valuation": CONFIG["valuation"],
    }
