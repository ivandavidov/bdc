from pipeline import events

PREV = {"ticker": "XYZ", "nav_date": "2026-06-30", "nav_ps": 20.0, "light": "green", "total": 72,
        "div_run_rate": 2.0, "nonaccrual_cost": 0.01, "flags": []}


def test_new_report_light_dividend_and_flag_changes():
    cur = {**PREV, "nav_date": "2026-09-30", "nav_ps": 19.0, "light": "yellow", "total": 65,
           "div_run_rate": 1.8, "nonaccrual_cost": 0.03, "flags": ["cut_12m"]}
    kinds = {e["kind"]: e for e in events.diff(PREV, cur, {})}
    assert set(kinds) == {"report", "light", "dividend", "nonaccrual", "flag"}
    assert kinds["report"]["severity"] == "bad"  # NAV −5%
    assert kinds["dividend"]["severity"] == "bad"
    assert "−10,0%" in kinds["dividend"]["text"] or "-10,0%" in kinds["dividend"]["text"]


def test_no_events_when_nothing_changed():
    assert events.diff(PREV, dict(PREV), {}) == []


def test_site_url_from_github_repository(monkeypatch):
    monkeypatch.delenv("SITE_URL", raising=False)
    monkeypatch.setenv("GITHUB_REPOSITORY", "Someone/bdc")
    assert events.site_url() == "https://someone.github.io/bdc/"
