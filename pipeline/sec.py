"""Minimal SEC EDGAR client: User-Agent, rate limiting and an on-disk cache."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data_cache"

DATASETS_URL = (
    "https://www.sec.gov/files/datastandardsinnovation/data/"
    "business-development-company-bdc-data-sets/{month}_bdc.zip"
)
TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json"
FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"

_MIN_INTERVAL = 0.12  # SEC allows 10 requests/second; stay just under
_last_request = 0.0
_session: requests.Session | None = None


def user_agent() -> str:
    ua = os.environ.get("SEC_USER_AGENT", "").strip()
    if not ua or "@" not in ua:
        raise SystemExit(
            "Set SEC_USER_AGENT to 'app-name your@email' (SEC requires a contact in the User-Agent)."
        )
    return ua


def _get(url: str, stream: bool = False) -> requests.Response:
    global _last_request, _session
    if _session is None:
        _session = requests.Session()
        _session.headers["User-Agent"] = user_agent()
    for attempt in range(4):
        wait = _MIN_INTERVAL - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        resp = _session.get(url, timeout=120, stream=stream)
        if resp.status_code in (429, 500, 502, 503, 504):
            time.sleep(2 ** attempt)
            continue
        return resp
    resp.raise_for_status()
    return resp


def get_json(url: str, cache_name: str | None = None, max_age_hours: float = 0) -> dict | None:
    """Fetch JSON; when cache_name is given, reuse a cached copy younger than max_age_hours."""
    path = CACHE / cache_name if cache_name else None
    if path and path.exists() and max_age_hours > 0:
        if time.time() - path.stat().st_mtime < max_age_hours * 3600:
            return json.loads(path.read_text())
    resp = _get(url)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    data = resp.json()
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))
    return data


def download(url: str, dest: Path) -> Path | None:
    """Download a file once; returns None when the URL does not exist."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    resp = _get(url, stream=True)
    if resp.status_code in (403, 404):
        return None
    resp.raise_for_status()
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with open(tmp, "wb") as fh:
        for chunk in resp.iter_content(1 << 20):
            fh.write(chunk)
    tmp.rename(dest)
    return dest


def company_facts(cik: int, max_age_hours: float = 0) -> dict | None:
    return get_json(FACTS_URL.format(cik=cik), f"facts/{cik}.json", max_age_hours)


def submissions(cik: int, max_age_hours: float = 0) -> dict | None:
    return get_json(SUBMISSIONS_URL.format(cik=cik), f"submissions/{cik}.json", max_age_hours)


def tickers_exchange(max_age_hours: float = 24) -> dict:
    return get_json(TICKERS_URL, "company_tickers_exchange.json", max_age_hours)


def dataset_zip(month: str) -> Path | None:
    """month is 'YYYY_MM'. Published monthly; the current month may not exist yet."""
    return download(DATASETS_URL.format(month=month), CACHE / "bdc_datasets" / f"{month}_bdc.zip")
