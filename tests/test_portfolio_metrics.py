from pipeline import metrics
from pipeline.portfolio import summarize_holdings, type_group


def test_investment_type_groups():
    assert type_group("First lien senior secured loan") == "first_lien"
    assert type_group("Unitranche") == "first_lien"
    assert type_group("Second Lien Notes") == "second_lien"
    assert type_group("Subordinated Debt") == "subordinated"
    assert type_group("CLO Equity") == "structured"
    assert type_group("Senior Secured Loan Fund LLC") == "structured"
    assert type_group("Warrants") == "equity"
    assert type_group("Unclassified") == "other"


def test_summarize_holdings_shares_and_concentration():
    rows = [
        {"company": "A", "type": "First lien", "industry": "Software", "fv": 60, "cost": 60, "rate": 0.10, "spread": 0.05, "pik": 0, "debt": True},
        {"company": "B", "type": "Common stock", "industry": "Health", "fv": 40, "cost": 30, "rate": None, "spread": None, "pik": 0, "debt": False},
    ]
    h = summarize_holdings(rows, 100)
    assert h["by_type"] == {"first_lien": 0.6, "equity": 0.4}
    assert h["top10_pct"] == 1.0
    assert h["floating"] == 1.0
    assert h["debt_yield"] == 0.10


def test_economic_return_and_coverage():
    extracted = {
        "quarters": ["2026-03-31", "2026-06-30"],
        "series": {name: {} for name in (
            "nav_per_share", "nii_per_share", "dist_per_share", "net_assets", "debt", "cash", "liabilities",
            "investments_fv", "investments_cost", "total_income", "nii", "interest_expense", "pik_interest",
            "pik_dividend", "asset_coverage", "shares", "mgmt_fee", "incentive_fee", "expense_ratio",
        )},
    }
    s = extracted["series"]
    s["nav_per_share"] = {"2026-03-31": 20.0, "2026-06-30": 19.8}
    s["nii_per_share"] = {"2026-06-30": 0.50}
    s["dist_per_share"] = {"2026-06-30": 0.48}
    s["net_assets"] = {"2026-06-30": 1000.0}
    s["debt"] = {"2026-06-30": 1100.0}
    s["liabilities"] = {"2026-06-30": 1150.0}
    classified = [{"date": "2026-06-15", "amount": 0.48, "freq": 4, "regular": 0.48, "special": 0.0}]
    q = metrics.quarterly(extracted, classified)
    assert round(q["econ_return"][1], 6) == round((19.8 - 20.0 + 0.48) / 20.0, 6)
    assert round(q["coverage"][1], 4) == round(0.50 / 0.48, 4)
    assert q["de"][1] == 1.1 and q["de_approx"][1] is False
    assert round(q["asset_coverage"][1], 4) == round(2100 / 1100, 4)
