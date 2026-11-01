from pipeline import health


def _company(ticker, manager, quarters, names=(), **q):
    n = len(quarters)
    base = {k: [None] * n for k in ("fv", "cost", "nonaccrual_cost", "nonaccrual_fv", "total_income", "pik", "nii", "net_assets")}
    base.update(q)
    return {"ticker": ticker, "manager": manager, "quarters": quarters, "q": base,
            "portfolio": {"nonaccrual_names": [{"name": nm, "fv": fv, "cost": cost} for nm, fv, cost in names]}}


def test_core_name_strips_prefixes_and_tranches():
    assert health.core_name("Pluralsight, LLC") == "pluralsight"
    assert health.core_name("First Brands Group, LLC - Automotive - 1st Lien Term Loan (3/21)") == "first brands"
    assert health.core_name("Ave Holdings III Corp.") == "ave holdings iii"
    assert health.core_name("Amerivet Partners Management, Inc. and AVE Holdings LP") == "amerivet partners management"


def test_series_is_weighted_by_size(monkeypatch):
    monkeypatch.setattr(health, "MIN_COMPANIES", 2)
    big = _company("BIG", "A", ["2026-06-30"], fv=[90.0], cost=[100.0], nonaccrual_cost=[0.04], nonaccrual_fv=[0.02],
                   total_income=[3.0], pik=[0.3], nii=[1.5], net_assets=[50.0])
    small = _company("SML", "B", ["2026-05-31"], fv=[10.0], cost=[10.0], nonaccrual_cost=[0.0], nonaccrual_fv=[0.0],
                     total_income=[0.25], pik=[0.0], nii=[0.1], net_assets=[5.0])
    s = health.series([big, small])
    assert s["quarters"] == ["2026Q2"]
    assert s["fv_cost"] == [100 / 110]
    assert s["unrealized"] == [-10.0]
    assert abs(s["nonaccrual_cost"][0] - 4 / 110) < 1e-12
    assert abs(s["pik_pct"][0] - 0.3 / 3.25) < 1e-12
    assert abs(s["income_yield"][0] - 13 / 100) < 1e-12


def test_series_skips_thin_quarters():
    c = _company("X", "A", ["2026-09-30"], fv=[1.0], cost=[1.0])
    assert health.series([c])["quarters"] == []


def test_shared_nonaccruals_match_across_bdcs():
    a = _company("AAA", "Mgr A", [], names=[("Pluralsight, LLC", 10.0, 50.0), ("Only Here Inc.", 1.0, 2.0)])
    b = _company("BBB", "Mgr B", [], names=[("Software Pluralsight, LLC First Lien", 5.0, 50.0)])
    c = _company("CCC", "Mgr B", [], names=[("Only Here Too, LLC", 1.0, 1.0)])
    shared = health.shared_nonaccruals([a, b, c])
    assert len(shared) == 1
    g = shared[0]
    assert g["name"] == "Pluralsight"
    assert g["tickers"] == ["AAA", "BBB"]
    assert g["managers"] == 2
    assert g["fv_cost"] == 15 / 100
