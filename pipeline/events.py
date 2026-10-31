"""Change log: compare today's summary with the previous one, keep a rolling log and RSS feed."""

from __future__ import annotations

import datetime as dt
import json
import os
from email.utils import format_datetime
from xml.sax.saxutils import escape

from . import scoring, sec

LOG_FILE = sec.ROOT / "docs" / "data" / "events.json"
FEED_FILE = sec.ROOT / "docs" / "feed.xml"
MAX_EVENTS = 400

LIGHT_BG = {"green": "зелено", "yellow": "жълто", "red": "червено", None: "няма"}


def site_url() -> str:
    url = os.environ.get("SITE_URL")
    if url:
        return url.rstrip("/") + "/"
    repo = os.environ.get("GITHUB_REPOSITORY")
    if repo and "/" in repo:
        owner, name = repo.split("/", 1)
        return f"https://{owner.lower()}.github.io/{name}/"
    return ""


def _pct(x):
    return f"{x * 100:+.1f}%".replace(".", ",")


def _num(x):
    return f"{x:.2f}".replace(".", ",")


def diff(prev: dict, cur: dict, company: dict) -> list[dict]:
    t = cur["ticker"]
    out = []

    def add(kind, severity, text):
        out.append({"ticker": t, "kind": kind, "severity": severity, "text": text})

    if prev.get("nav_date") != cur.get("nav_date") and cur.get("nav_ps") and prev.get("nav_ps"):
        change = cur["nav_ps"] / prev["nav_ps"] - 1
        sev = "bad" if change < -0.03 else "good" if change > 0.01 else "info"
        add("report", sev, f"Нов отчет към {cur['nav_date']}: NAV/акция {_num(cur['nav_ps'])} $ ({_pct(change)} спрямо предходния)")
    if prev.get("light") != cur.get("light") and cur.get("light"):
        order = {"red": 0, "yellow": 1, "green": 2}
        sev = "good" if order.get(cur["light"], 0) > order.get(prev.get("light"), 0) else "bad"
        add("light", sev, f"Светофарът се смени от {LIGHT_BG[prev.get('light')]} на {LIGHT_BG[cur['light']]} (скор {_num(cur['total'] or 0)})")
    p_div, c_div = prev.get("div_run_rate"), cur.get("div_run_rate")
    if p_div and c_div is not None and abs(c_div / p_div - 1) > 0.02:
        change = c_div / p_div - 1
        add("dividend", "bad" if change < 0 else "good",
            f"Редовният дивидент е {'намален' if change < 0 else 'увеличен'}: {_num(p_div)} → {_num(c_div)} $ годишно ({_pct(change)})")
    p_na, c_na = prev.get("nonaccrual_cost"), cur.get("nonaccrual_cost")
    if p_na is not None and c_na is not None and abs(c_na - p_na) >= 0.01:
        add("nonaccrual", "bad" if c_na > p_na else "good",
            f"Non-accruals: {p_na * 100:.1f}% → {c_na * 100:.1f}% от портфейла".replace(".", ","))
    for flag in set(cur.get("flags") or []) - set(prev.get("flags") or []):
        add("flag", "bad", f"Нов червен флаг: {scoring.CONFIG['flags'][flag]}")
    return out


def update(previous: dict | None, summary: list[dict], companies: list[dict], today: dt.date) -> list[dict]:
    log = json.loads(LOG_FILE.read_text()) if LOG_FILE.exists() else []
    prev_rows = {r["ticker"]: r for r in (previous or {}).get("companies", [])}
    by_ticker = {c["ticker"]: c for c in companies}
    new = []
    for row in summary:
        if previous is None:
            continue
        prev = prev_rows.get(row["ticker"])
        if prev is None:
            new.append({"ticker": row["ticker"], "kind": "new", "severity": "info",
                        "text": f"{row['name']} е добавена в списъка с борсови BDC"})
            continue
        new.extend(diff(prev, row, by_ticker[row["ticker"]]))
    for row in prev_rows.values():
        if row["ticker"] not in by_ticker:
            new.append({"ticker": row["ticker"], "kind": "removed", "severity": "info",
                        "text": f"{row['name']} отпадна от списъка (делистната, слята или без нови отчети)"})
    stamp = today.isoformat()
    for e in new:
        e["date"] = stamp
    log = (new + log)[:MAX_EVENTS]
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    LOG_FILE.write_text(json.dumps(log, ensure_ascii=False, separators=(",", ":")))
    write_feed(log[:60])
    return log


def write_feed(entries: list[dict]) -> None:
    base = site_url()
    now = format_datetime(dt.datetime.now(dt.timezone.utc))
    items = []
    for i, e in enumerate(entries):
        when = dt.datetime.fromisoformat(e["date"]).replace(tzinfo=dt.timezone.utc)
        link = f"{base}company.html?t={e['ticker']}"
        items.append(
            "<item>"
            f"<title>{escape(e['ticker'])}: {escape(e['text'])}</title>"
            f"<link>{escape(link)}</link>"
            f"<guid isPermaLink=\"false\">{escape(e['date'])}-{escape(e['ticker'])}-{escape(e['kind'])}-{i}</guid>"
            f"<pubDate>{format_datetime(when)}</pubDate>"
            "</item>"
        )
    FEED_FILE.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0"><channel>'
        "<title>BDC Радар — промени</title>"
        f"<link>{escape(base + 'changes.html')}</link>"
        "<description>Важни промени при борсово търгуваните BDC: отчети, дивиденти, non-accruals, светофар.</description>"
        "<language>bg</language>"
        f"<lastBuildDate>{now}</lastBuildDate>"
        + "".join(items)
        + "</channel></rss>\n",
        encoding="utf-8",
    )
