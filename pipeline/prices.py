"""Market data from Yahoo Finance via yfinance (unofficial API).

When a download fails the last cached copy is reused, so one bad day at Yahoo
leaves yesterday's prices in place instead of breaking the build.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import warnings

import pandas as pd
import yfinance as yf

from . import sec

CACHE = sec.CACHE / "prices"
HISTORY_START = "2012-01-01"
log = logging.getLogger(__name__)

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)


def _download(ticker: str) -> dict | None:
    hist = yf.Ticker(ticker).history(start=HISTORY_START, auto_adjust=False, actions=True)
    if hist is None or hist.empty:
        return None
    hist.index = hist.index.tz_localize(None).normalize()
    hist = hist[hist["Close"].notna()]

    weekly = hist[["Close", "Adj Close"]].resample("W-FRI").last().dropna()
    recent = hist.tail(63)
    divs = hist.loc[hist["Dividends"] > 0, "Dividends"]
    splits = hist.loc[hist["Stock Splits"] > 0, "Stock Splits"]
    last_year = hist[hist.index >= hist.index[-1] - pd.Timedelta(days=365)]

    def ret(years: int) -> float | None:
        start = hist.index[-1] - pd.DateOffset(years=years)
        if hist.index[0] > start + pd.Timedelta(days=7):
            return None
        base = hist.loc[hist.index >= start, "Adj Close"].iloc[0]
        return float(hist["Adj Close"].iloc[-1] / base - 1)

    return {
        "ticker": ticker,
        "fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "last": {
            "date": hist.index[-1].date().isoformat(),
            "close": round(float(hist["Close"].iloc[-1]), 4),
            "high_52w": round(float(last_year["High"].max()), 4),
            "low_52w": round(float(last_year["Low"].min()), 4),
            "avg_dollar_volume_3m": round(float((recent["Close"] * recent["Volume"]).mean()), 0),
        },
        "returns": {"1y": ret(1), "3y": ret(3), "5y": ret(5)},
        "weekly": [
            [d.date().isoformat(), round(float(c), 4), round(float(a), 4)]
            for d, c, a in weekly.itertuples()
        ],
        "dividends": [[d.date().isoformat(), round(float(v), 6)] for d, v in divs.items()],
        "splits": [[d.date().isoformat(), float(v)] for d, v in splits.items()],
    }


def get(ticker: str) -> dict | None:
    path = CACHE / f"{ticker}.json"
    try:
        data = _download(ticker)
    except Exception as exc:  # yfinance raises a variety of errors on throttling/outages
        log.warning("price download failed for %s: %s", ticker, exc)
        data = None
    if data:
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
        return data
    if path.exists():
        cached = json.loads(path.read_text())
        cached["stale"] = True
        return cached
    return None
