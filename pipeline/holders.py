"""Largest shareholders from Yahoo Finance (based on 13F filings, so 1–3 months old).

Ownership changes quarterly, so a cached copy younger than a week is reused;
on a failed download the last cached copy is kept.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import math
import time

import yfinance as yf

from . import sec

CACHE = sec.CACHE / "holders"
MAX_AGE_DAYS = 7
log = logging.getLogger(__name__)


def _num(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(x) else x


def _rows(df, limit: int) -> list[dict]:
    if df is None or len(df) == 0:
        return []
    out = []
    for _, r in df.head(limit).iterrows():
        reported = r.get("Date Reported")
        out.append({
            "name": str(r.get("Holder", "")).strip(),
            "pct": _num(r.get("pctHeld")),
            "shares": _num(r.get("Shares")),
            "value": _num(r.get("Value")),
            "change": _num(r.get("pctChange")),
            "date": reported.date().isoformat() if hasattr(reported, "date") else None,
        })
    return out


def _download(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    major = t.major_holders
    summary = {}
    if major is not None and len(major):
        col = major.columns[0]
        summary = {str(k): _num(v) for k, v in major[col].items()}
    return {
        "fetched": dt.date.today().isoformat(),
        "insiders": summary.get("insidersPercentHeld"),
        "institutions": summary.get("institutionsPercentHeld"),
        "institutions_count": summary.get("institutionsCount"),
        "institutional": _rows(t.institutional_holders, 10),
        "funds": _rows(t.mutualfund_holders, 5),
    }


def get(ticker: str) -> dict | None:
    path = CACHE / f"{ticker}.json"
    if path.exists() and time.time() - path.stat().st_mtime < MAX_AGE_DAYS * 86400:
        return json.loads(path.read_text())
    try:
        data = _download(ticker)
    except Exception as exc:  # unofficial API: keep the previous copy on failure
        log.warning("holders download failed for %s: %s", ticker, exc)
        data = None
    if data and (data["institutional"] or data["insiders"] is not None):
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
        return data
    return json.loads(path.read_text()) if path.exists() else None
