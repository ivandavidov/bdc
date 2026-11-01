"""Portfolio health across all BDCs: what the lenders' books say about the borrowers.

Sums (not medians) by calendar quarter, so each ratio is weighted by portfolio size,
plus borrowers that sit on the non-accrual list of more than one BDC.
"""

from __future__ import annotations

import re

MIN_COMPANIES = 25  # fewer reporters means the quarter is still being filed
SHARED_LIMIT = 15

# Words that end a borrower's own name; descriptions and tranches follow them.
_SUFFIX = re.compile(
    r"\b(L\.?L\.?C|Inc|Corp|Corporation|Co|L\.?P|Ltd|Limited|Holdings?|Holdco|Group|Parent|Buyer|"
    r"Purchaser|Intermediate|TopCo|Acquisition)\b\.?",
    re.IGNORECASE,
)
_STOP = re.compile(r"\s*(,|\(| - | – |\bdba\b|\bf/k/a\b|\band\b)", re.IGNORECASE)


def _quarter(date: str) -> str:
    return f"{date[:4]}Q{(int(date[5:7]) - 1) // 3 + 1}"


def series(companies: list[dict]) -> dict:
    """Portfolio-weighted ratios by calendar quarter."""
    sums: dict[str, dict[str, float]] = {}
    for c in companies:
        q = c["q"]
        for i, d in enumerate(c["quarters"]):
            s = sums.setdefault(_quarter(d), {})
            add = lambda k, v: s.__setitem__(k, s.get(k, 0.0) + v)  # noqa: E731
            fv, cost = q["fv"][i], q["cost"][i]
            if fv and cost:
                add("n", 1)
                add("fv", fv)
                add("cost", cost)
                if q["nonaccrual_cost"][i] is not None:
                    add("na_cost", q["nonaccrual_cost"][i] * cost)
                    add("na_fv", (q["nonaccrual_fv"][i] or 0) * fv)
                    add("na_base_cost", cost)
                    add("na_base_fv", fv)
            income, pik = q["total_income"][i], q["pik"][i]
            if income and pik is not None:
                add("pik", pik)
                add("pik_income", income)
            if income and fv:
                add("income", income)
                add("income_fv", fv)
            nii, na = q["nii"][i], q["net_assets"][i]
            if nii is not None and na:
                add("nii", nii)
                add("net_assets", na)

    div = lambda a, b: a / b if b else None  # noqa: E731
    keys = sorted(k for k, s in sums.items() if s.get("n", 0) >= MIN_COMPANIES)
    rows = [sums[k] for k in keys]
    return {
        "quarters": keys,
        "count": [int(s["n"]) for s in rows],
        "fv": [s["fv"] for s in rows],
        "unrealized": [s["fv"] - s["cost"] for s in rows],
        "fv_cost": [div(s["fv"], s["cost"]) for s in rows],
        "nonaccrual_cost": [div(s.get("na_cost", 0), s.get("na_base_cost")) for s in rows],
        "nonaccrual_fv": [div(s.get("na_fv", 0), s.get("na_base_fv")) for s in rows],
        "pik_pct": [div(s.get("pik", 0), s.get("pik_income")) for s in rows],
        "income_yield": [div(4 * s.get("income", 0), s.get("income_fv")) for s in rows],
        "nii_roe": [div(4 * s.get("nii", 0), s.get("net_assets")) for s in rows],
    }


def current(companies: list[dict]) -> dict:
    """Latest schedule of investments, weighted by portfolio fair value."""
    out = {}
    for key in ("pik_exposure", "debt_yield", "floating"):
        pairs = [(p[key], p["total_fv"]) for c in companies
                 if (p := c.get("portfolio")) and p.get("reliable") and p.get(key) is not None and p.get("total_fv")]
        total = sum(w for _, w in pairs)
        out[key] = sum(v * w for v, w in pairs) / total if total else None
        out[f"{key}_n"] = len(pairs)
    return out


def _head(name: str) -> str:
    """The borrower's own name: text before the first legal suffix or separator."""
    head = _STOP.split(name or "", maxsplit=1)[0]
    m = _SUFFIX.search(head)
    if m and m.start() > 0:
        rest = head[m.end():].split()
        head = head[:m.start()]
        # a short single word ("Ave Holdings") needs its suffix to stay distinctive
        if len(head.split()) == 1 and len(head.strip()) < 5:
            head = f"{head} {m.group(1)} {' '.join(rest[:1])}"
    return " ".join(head.split()).strip(" ,.-–")


def core_name(name: str) -> str:
    """Lower-cased _head without punctuation, for matching across filings."""
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", _head(name).lower()).split())


def _same(a: str, b: str) -> bool:
    """One core ends the other: filings often prefix the name with industry or type."""
    short, long_ = sorted((a, b), key=len)
    if len(short) < 5:
        return False
    return long_ == short or long_.endswith(" " + short)


def shared_nonaccruals(companies: list[dict], limit: int = SHARED_LIMIT) -> list[dict]:
    """Borrowers on the non-accrual list of two or more BDCs, worst-hit first."""
    entries = []
    for c in companies:
        for n in (c.get("portfolio") or {}).get("nonaccrual_names") or []:
            core = core_name(n["name"])
            if core:
                entries.append({"core": core, "label": _head(n["name"]), "ticker": c["ticker"], "manager": c.get("manager") or c["ticker"],
                                "fv": n.get("fv") or 0.0, "cost": n.get("cost") or 0.0})

    parent = list(range(len(entries)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            if entries[i]["ticker"] != entries[j]["ticker"] and _same(entries[i]["core"], entries[j]["core"]):
                parent[find(i)] = find(j)

    groups: dict[int, list[dict]] = {}
    for i, e in enumerate(entries):
        groups.setdefault(find(i), []).append(e)

    out = []
    for members in groups.values():
        tickers = sorted({e["ticker"] for e in members})
        if len(tickers) < 2:
            continue
        cost = sum(e["cost"] for e in members)
        fv = sum(e["fv"] for e in members)
        out.append({
            "name": min(members, key=lambda e: (len(e["core"]), e["label"].isupper()))["label"],
            "tickers": tickers,
            "managers": len({e["manager"] for e in members}),
            "cost": cost,
            "fv": fv,
            "fv_cost": fv / cost if cost else None,
        })
    out.sort(key=lambda g: (-g["managers"], -len(g["tickers"]), -g["cost"]))
    return out[:limit]


def build(companies: list[dict]) -> dict:
    return {"series": series(companies), "current": current(companies), "shared_nonaccruals": shared_nonaccruals(companies)}
