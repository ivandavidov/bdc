"""Discover exchange-listed BDCs and keep config/universe.yaml in sync.

A company is a BDC here when it filed financial statements in the SEC BDC Data
Sets (file numbers 814-...). It is "listed" when SEC's ticker file maps its CIK
to NYSE or Nasdaq. The first ticker SEC lists for a CIK is the common stock;
notes and preferreds (e.g. GAINI, SAZ) come after it and are ignored.
"""

from __future__ import annotations

import datetime as dt
import zipfile

import pandas as pd
import yaml

from . import sec

UNIVERSE_FILE = sec.ROOT / "config" / "universe.yaml"
EXCHANGES = {"NYSE", "Nasdaq"}
MONTHS_NEEDED = 4  # every BDC files a 10-Q/10-K at least once per quarter


def recent_dataset_months(n: int = MONTHS_NEEDED, today: dt.date | None = None) -> list[str]:
    """Most recent n monthly data set archives that exist, newest first."""
    today = today or dt.date.today()
    year, month = today.year, today.month
    found: list[str] = []
    for _ in range(n + 6):
        tag = f"{year}_{month:02d}"
        if sec.dataset_zip(tag):
            found.append(tag)
            if len(found) == n:
                break
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    for old in (sec.CACHE / "bdc_datasets").glob("*_bdc.zip"):
        if old.name[:7] not in found:
            old.unlink()  # keep the cache (and the CI cache) small
    return found


def read_sub(month: str) -> pd.DataFrame:
    with zipfile.ZipFile(sec.CACHE / "bdc_datasets" / f"{month}_bdc.zip") as z:
        return pd.read_csv(z.open("datasets/sub.tsv"), sep="\t", dtype=str)


def discover(months: list[str]) -> dict[int, dict]:
    subs = pd.concat([read_sub(m) for m in months], ignore_index=True)
    subs = subs.sort_values("filed").drop_duplicates("cik", keep="last")
    ex = sec.tickers_exchange()
    tickers: dict[int, list[tuple[str, str]]] = {}
    for row in ex["data"]:
        rec = dict(zip(ex["fields"], row))
        if rec["exchange"] in EXCHANGES:
            tickers.setdefault(rec["cik"], []).append((rec["ticker"], rec["exchange"]))

    found = {}
    for _, s in subs.iterrows():
        cik = int(s["cik"])
        if cik not in tickers:
            continue
        ticker, exchange = tickers[cik][0]
        found[cik] = {
            "ticker": ticker,
            "cik": cik,
            "name": pretty_name(s["name"]),
            "exchange": exchange,
            "fye": s["fye"],
            "file_number": s.get("fileNumber") or None,
        }
    return found


_UPPER = {"Bdc", "Kkr", "Fs", "Tcp", "Slr", "Msc", "Bcp", "Ofs", "Ii", "Iii", "Llc", "Lp"}


def pretty_name(raw: str) -> str:
    """EDGAR names are upper case; title-case them but keep acronyms."""
    words = raw.title().replace("Corporationde", "Corporation").split()
    return " ".join(w.upper() if w.strip(",.") in _UPPER else w for w in words)


def load() -> dict[str, dict]:
    if not UNIVERSE_FILE.exists():
        return {}
    data = yaml.safe_load(UNIVERSE_FILE.read_text()) or {}
    return data.get("companies", {})


def save(companies: dict[str, dict]) -> None:
    header = (
        "# Борсово търгувани BDC. Генерира се от pipeline/universe.py;\n"
        "# ръчните полета (manager, managed, exclude, note) се запазват при обновяване.\n"
        "# managed: internal | external | auto (auto = по XBRL: има ли такса за управление)\n"
    )
    body = yaml.safe_dump({"companies": dict(sorted(companies.items()))}, allow_unicode=True, sort_keys=False)
    UNIVERSE_FILE.write_text(header + body)


def refresh() -> dict[str, dict]:
    """Merge newly discovered BDCs into universe.yaml and return active companies."""
    months = recent_dataset_months()
    found = discover(months)
    current = load()
    by_cik = {c["cik"]: t for t, c in current.items()}
    listed_ciks = {r[0] for r in sec.tickers_exchange()["data"] if r[3] in EXCHANGES}

    for cik, auto in found.items():
        ticker = by_cik.get(cik)
        if ticker is None:
            current[auto["ticker"]] = {**auto, "managed": "auto", "added": dt.date.today().isoformat()}
            continue
        entry = current[ticker]
        for key in ("name", "exchange", "fye", "file_number"):
            entry[key] = auto[key]
        entry["active"] = True
        if auto["ticker"] != ticker and not entry.get("ticker_locked"):
            current[auto["ticker"]] = {**entry, "ticker": auto["ticker"]}
            del current[ticker]

    for ticker, entry in current.items():
        if entry["cik"] not in listed_ciks:
            entry["active"] = False  # delisted or merged away
        entry.setdefault("active", True)

    save(current)
    return {t: c for t, c in current.items() if c.get("active") and not c.get("exclude")}


if __name__ == "__main__":
    active = refresh()
    print(f"{len(active)} active listed BDCs: {', '.join(sorted(active))}")
