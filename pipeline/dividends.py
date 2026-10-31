"""Split a raw dividend history into regular and special/supplemental payments.

Yahoo lists every ex-dividend payment without saying which are specials, and
several BDCs switched from quarterly to monthly payments in 2025-26. Payments
are walked in date order against the last regular payment:

- local frequency comes from the gap to the nearest neighbour with a similar
  amount (<= 40 days monthly, <= 125 quarterly, <= 250 semiannual, else annual);
- a payment that comes less than half a period after the last regular one is a
  special, unless the frequency switched and the annualized amount still fits;
- a payment worth < 35% of the regular annualized rate is a supplemental unless
  the next payment confirms the new level (a deep cut);
- a payment > 125% of the last regular one is split into regular + special
  unless the next payment confirms the raise (combined declarations such as
  CSWC's monthly + quarterly supplemental).

Everything downstream compares annualized amounts (amount x frequency), so a
switch from 0.51 quarterly to 0.17 monthly is not mistaken for a cut.
"""

from __future__ import annotations

import datetime as dt
from statistics import median


def _d(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def _similar(a: float, b: float) -> bool:
    return a > 0 and b > 0 and 0.6 <= a / b <= 1.67


def _close(a: float, b: float) -> bool:
    return a > 0 and b > 0 and 0.85 <= a / b <= 1.18


def _local_frequencies(dates: list[dt.date], amounts: list[float]) -> list[int]:
    """Monthly needs two similar neighbours (one within 40 days, another within 70);
    a lone special next to a quarterly payment must not flip the frequency."""
    n = len(dates)
    out = []
    for i in range(n):
        near = [j for j in (i - 2, i - 1, i + 1, i + 2) if 0 <= j < n]
        gaps = sorted(abs((dates[j] - dates[i]).days) for j in near if _similar(amounts[j], amounts[i]))
        if len(gaps) >= 2 and gaps[0] <= 40 and gaps[1] <= 70:
            out.append(12)
            continue
        spaced = [abs((dates[j] - dates[i]).days) for j in near]
        similar = [g for j, g in zip(near, spaced) if g > 40 and _similar(amounts[j], amounts[i])]
        g = min(similar or [g for g in spaced if g > 40] or [365])
        out.append(12 if g <= 40 else 4 if g <= 125 else 2 if g <= 250 else 1)
    return out


def classify(divs: list[list]) -> list[dict]:
    """Returns [{date, amount, freq, regular, special}] in date order."""
    if not divs:
        return []
    dates = [_d(d) for d, _ in divs]
    amounts = [float(a) for _, a in divs]
    freqs = _local_frequencies(dates, amounts)
    out: list[dict] = []
    last: dict | None = None  # last regular payment

    def confirmed_raise(i: int) -> bool:
        """The next payment at a normal interval repeats the higher amount."""
        for j in range(i + 1, min(i + 3, len(divs))):
            if (dates[j] - dates[i]).days >= 0.5 * 365 / freqs[j]:
                return _close(amounts[j] * freqs[j], amounts[i] * freqs[i])
        return False

    def confirmed_cut(i: int, last_amount: float, last_freq: int) -> bool:
        """No payment near the old level arrives within the next ~1.2 periods."""
        horizon = dates[i] + dt.timedelta(days=1.2 * 365 / last_freq)
        later = [j for j in range(i + 1, len(divs)) if dates[j] <= horizon]
        return bool(later) and all(amounts[j] < 0.6 * last_amount for j in later)

    for i, (date, amount, freq) in enumerate(zip(dates, amounts, freqs)):
        rec = {"date": divs[i][0], "amount": amount, "freq": freq, "regular": amount, "special": 0.0}
        if last is not None:
            annual, last_annual = amount * freq, last["regular"] * last["freq"]
            too_soon = (date - _d(last["date"])).days < 0.5 * 365 / last["freq"]
            switched = freq > last["freq"] and _similar(annual, last_annual)
            if too_soon and not switched:
                rec["regular"], rec["special"] = 0.0, amount
            elif annual < 0.35 * last_annual and not confirmed_cut(i, last["regular"], last["freq"]):
                rec["regular"], rec["special"] = 0.0, amount
            elif freq == last["freq"] and amount > 1.25 * last["regular"] and not confirmed_raise(i):
                rec["regular"], rec["special"] = last["regular"], amount - last["regular"]
        rec["regular"] = round(rec["regular"], 6)
        rec["special"] = round(rec["special"], 6)
        if rec["regular"] > 0:
            last = rec
        out.append(rec)
    return out


def regular_payments(classified: list[dict]) -> list[dict]:
    return [p for p in classified if p["regular"] > 0]


def run_rate(classified: list[dict], as_of: dt.date) -> float | None:
    """Annualized regular dividend from the last regular payment on or before as_of.

    0.0 when the last regular payment is more than 1.5 periods old (suspended).
    """
    regs = [p for p in regular_payments(classified) if _d(p["date"]) <= as_of]
    if not regs:
        return None
    last = regs[-1]
    if (as_of - _d(last["date"])).days > 1.5 * 365 / last["freq"] + 30:
        return 0.0
    return last["regular"] * last["freq"]


def cuts(classified: list[dict], since: dt.date, tolerance: float = 0.05) -> list[dict]:
    """Drops of the annualized regular dividend by more than `tolerance`.

    The following regular payment must stay below the old level too, so a
    single misclassified payment does not count as a cut.
    """
    regs = regular_payments(classified)
    annual = [p["regular"] * p["freq"] for p in regs]
    events = []
    for k in range(1, len(regs)):
        floor = annual[k - 1] * (1 - tolerance)
        if _d(regs[k]["date"]) < since or annual[k] >= floor:
            continue
        if k + 1 < len(regs) and annual[k + 1] >= floor:
            continue
        events.append({
            "date": regs[k]["date"],
            "from": round(annual[k - 1], 4),
            "to": round(annual[k], 4),
            "change": round(annual[k] / annual[k - 1] - 1, 4),
        })
    return events


def quarterly_regular(classified: list[dict], quarter_end: str) -> float | None:
    """Regular dividend attributable to the quarter ending on quarter_end.

    Median annualized regular payment with ex-date in (q_end - 75d, q_end + 30d],
    divided by four. Ex-dates drift around quarter ends, so a run rate is
    steadier than summing payments that happen to fall inside the quarter.
    """
    end = _d(quarter_end)
    lo, hi = end - dt.timedelta(days=75), end + dt.timedelta(days=30)
    rates = [p["regular"] * p["freq"] for p in regular_payments(classified) if lo < _d(p["date"]) <= hi]
    return median(rates) / 4 if rates else None


def trailing_total(classified: list[dict], as_of: dt.date, days: int = 365) -> tuple[float, float]:
    """(regular, special) paid with ex-date in the trailing window."""
    start = as_of - dt.timedelta(days=days)
    reg = sum(p["regular"] for p in classified if start < _d(p["date"]) <= as_of)
    spe = sum(p["special"] for p in classified if start < _d(p["date"]) <= as_of)
    return reg, spe
