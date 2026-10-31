from pipeline import scoring

GOOD = {
    "coverage_ttm": 1.15, "cuts_5y": 0, "pik_pct_ttm": 0.03,
    "nav_tr_3y": 0.12, "nav_chg_3y": 0.02, "nav_tr_1y": 0.12, "nav_cagr_long": 0.01,
    "nonaccrual_cost": 0.01, "fv_cost": 1.02, "first_lien": 0.95, "top10": 0.12,
    "net_de": 0.8, "asset_coverage": 2.2, "opex_ratio": 0.02, "managed": "internal",
}


def test_interpolate_clamps_and_interpolates():
    pts = [[0.85, 0], [1.0, 60], [1.1, 100]]
    assert scoring.interpolate(0.5, pts) == 0
    assert scoring.interpolate(2.0, pts) == 100
    assert scoring.interpolate(1.05, pts) == 80


def test_strong_company_is_green_with_full_coverage():
    s = scoring.score(GOOD)
    assert s["total"] == 100 and s["light"] == "green"
    assert not s["incomplete"] and s["flags"] == []


def test_missing_metrics_reweight_and_mark_incomplete():
    partial = {k: GOOD[k] for k in ("coverage_ttm", "nav_tr_3y")}
    s = scoring.score(partial)
    assert s["total"] == 100
    assert s["incomplete"]
    assert s["categories"]["credit"] is None


def test_one_flag_caps_light_at_yellow_three_make_red():
    one = scoring.score({**GOOD, "cut_12m": True})
    assert one["light"] == "yellow" and one["flags"] == ["cut_12m"]
    three = scoring.score({**GOOD, "cut_12m": True, "nonaccrual_cost": 0.09, "asset_coverage": 1.6})
    assert three["light"] == "red"


def test_valuation_label_from_z_score():
    assert scoring.valuation({"p_nav_z": -1.5}) == "cheap"
    assert scoring.valuation({"p_nav_z": 0.2}) == "fair"
    assert scoring.valuation({"p_nav_z": 1.2}) == "expensive"
    assert scoring.valuation({}) is None


def test_weak_core_category_forces_red_despite_high_average():
    eroding = {**GOOD, "nav_tr_3y": -0.08, "nav_chg_3y": -0.38, "nav_tr_1y": -0.05, "nav_cagr_long": -0.06}
    s = scoring.score(eroding)
    assert s["total"] >= 70  # other categories keep the average high...
    assert s["categories"]["nav"] < 25
    assert s["weak"] == ["nav"] and s["light"] == "red"  # ...but the weakest link decides
