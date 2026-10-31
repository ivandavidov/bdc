import datetime as dt

from pipeline import dividends as D


def monthly(start_year, months, amount, day=8):
    out = []
    y, m = start_year, 1
    for _ in range(months):
        out.append([f"{y}-{m:02d}-{day:02d}", amount])
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def test_monthly_with_supplemental_in_same_month():
    divs = monthly(2025, 12, 0.265)
    divs.insert(9, ["2025-09-21", 0.30])
    c = D.classify(divs)
    special = [p for p in c if p["special"] > 0]
    assert [p["date"] for p in special] == ["2025-09-21"]
    assert D.run_rate(c, dt.date(2026, 1, 1)) == 0.265 * 12


def test_quarterly_with_small_supplementals():
    divs = []
    for y in (2024, 2025):
        for m, d in ((3, 31), (6, 30), (9, 30), (12, 31)):
            divs.append([f"{y}-{m:02d}-{d}", 0.37])
            divs.append([f"{y}-{m + 1 if m < 12 else 12:02d}-{28 if m < 12 else 31}", 0.02]) if m < 12 else None
    divs.sort()
    c = D.classify(divs)
    assert all(p["regular"] == 0 for p in c if p["amount"] == 0.02)
    assert D.cuts(c, dt.date(2024, 1, 1)) == []
    assert D.quarterly_regular(c, "2025-06-30") == 0.37


def test_switch_from_quarterly_to_monthly_is_not_a_cut():
    divs = [["2025-03-31", 0.51], ["2025-06-30", 0.51], ["2025-09-30", 0.51], ["2025-12-31", 0.51]]
    divs += [[f"2026-{m:02d}-15", 0.17] for m in range(1, 10)]
    c = D.classify(divs)
    assert D.cuts(c, dt.date(2025, 1, 1)) == []
    assert round(D.run_rate(c, dt.date(2026, 10, 1)), 4) == 2.04


def test_real_cut_is_detected_and_must_persist():
    divs = [["2025-03-15", 0.48], ["2025-06-15", 0.48], ["2025-09-15", 0.48], ["2025-12-15", 0.42], ["2026-03-15", 0.42]]
    events = D.cuts(D.classify(divs), dt.date(2025, 1, 1))
    assert len(events) == 1 and events[0]["date"] == "2025-12-15"


def test_combined_monthly_and_supplemental_payment_is_split():
    divs = []
    for m in range(1, 13):
        divs.append([f"2026-{m:02d}-15", 0.253 if m % 3 == 0 else 0.193])
    c = D.classify(divs)
    assert all(abs(p["regular"] - 0.193) < 1e-9 for p in c[1:])
    assert D.cuts(c, dt.date(2026, 1, 1)) == []


def test_suspended_dividend_has_zero_run_rate():
    c = D.classify([["2025-01-15", 0.14], ["2025-04-15", 0.14], ["2025-07-15", 0.14]])
    assert D.run_rate(c, dt.date(2026, 10, 1)) == 0.0
