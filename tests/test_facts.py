from pipeline import facts


def fact(val, end, start=None, filed="2026-01-01", form="10-Q"):
    row = {"val": val, "end": end, "filed": filed, "form": form}
    if start:
        row["start"] = start
    return row


def company(tag_rows: dict, unit_by_tag: dict | None = None) -> dict:
    unit_by_tag = unit_by_tag or {}
    return {"facts": {"us-gaap": {
        tag: {"units": {unit_by_tag.get(tag, "USD/shares"): rows}} for tag, rows in tag_rows.items()
    }}}


NAV = [fact(20.0, "2025-12-31", filed="2026-02-01", form="10-K"), fact(19.8, "2026-03-31"),
       fact(19.6, "2026-06-30"), fact(19.5, "2026-09-30")]


def test_quarters_from_ytd_differences():
    data = company({
        "NetAssetValuePerShare": NAV,
        "InvestmentCompanyInvestmentIncomeLossPerShare": [
            fact(0.55, "2026-03-31", "2026-01-01"),
            fact(1.05, "2026-06-30", "2026-01-01"),
            fact(1.51, "2026-09-30", "2026-01-01"),
        ],
    })
    out = facts.extract(data)
    nii = out["series"]["nii_per_share"]
    assert out["quarters"] == ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"]
    assert nii["2026-03-31"] == 0.55
    assert round(nii["2026-06-30"], 4) == 0.50
    assert round(nii["2026-09-30"], 4) == 0.46


def test_q4_from_full_year_minus_nine_months():
    data = company({
        "NetAssetValuePerShare": [fact(20, "2025-06-30"), fact(20, "2025-09-30"), fact(20, "2025-12-31", form="10-K")],
        "InvestmentCompanyInvestmentIncomeLossPerShare": [
            fact(1.50, "2025-09-30", "2025-01-01"),
            fact(2.02, "2025-12-31", "2025-01-01", form="10-K"),
        ],
    })
    nii = facts.extract(data)["series"]["nii_per_share"]
    assert round(nii["2025-12-31"], 4) == 0.52


def test_direct_quarter_preferred_and_restatement_wins():
    data = company({
        "NetAssetValuePerShare": NAV,
        "InvestmentCompanyInvestmentIncomeLossPerShare": [
            fact(0.40, "2026-06-30", "2026-04-01", filed="2026-08-01"),
            fact(0.45, "2026-06-30", "2026-04-01", filed="2026-11-01"),  # later restatement
            fact(1.05, "2026-06-30", "2026-01-01"),
        ],
    })
    assert facts.extract(data)["series"]["nii_per_share"]["2026-06-30"] == 0.45


def test_reverse_split_restates_old_per_share_values():
    data = company({
        "NetAssetValuePerShare": [fact(2.0, "2021-12-31", filed="2022-02-01"), fact(12.0, "2022-03-31", filed="2022-05-01")],
    })
    out = facts.extract(data, splits=[("2022-02-28", 1 / 6)])
    assert round(out["series"]["nav_per_share"]["2021-12-31"], 6) == 12.0
    assert out["series"]["nav_per_share"]["2022-03-31"] == 12.0


def test_tag_fallback_fills_missing_periods():
    data = company(
        {"NetAssetValuePerShare": NAV, "LongTermDebt": [fact(100, "2026-03-31")], "DebtInstrumentCarryingAmount": [fact(90, "2026-06-30"), fact(1, "2026-03-31")]},
        {"LongTermDebt": "USD", "DebtInstrumentCarryingAmount": "USD"},
    )
    debt = facts.extract(data)["series"]["debt"]
    assert debt == {"2026-03-31": 100, "2026-06-30": 90}


def test_quarter_ends_drop_history_before_a_gap():
    nav = {d: 10.0 for d in ("2018-12-31", "2022-03-31", "2022-06-30", "2022-09-30")}
    assert facts.quarter_ends(nav) == ["2022-03-31", "2022-06-30", "2022-09-30"]
