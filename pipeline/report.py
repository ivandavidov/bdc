"""Data-quality report for the built JSON: python -m pipeline.report

Prints which scoring metrics are missing per company, portfolio coverage
versus the balance sheet, and investment types that fell into "other".
"""

from __future__ import annotations

import json
from collections import Counter

from . import portfolio, scoring, sec

DATA = sec.ROOT / "docs" / "data"


def main() -> None:
    summary = json.loads((DATA / "summary.json").read_text())["companies"]
    metrics = [m for cat in scoring.CONFIG["categories"].values() for m in cat["metrics"] if m != "internal"]
    missing = Counter()
    print(f"{'BDC':6} {'скор':>5} {'свет.':7} {'покр.':>6}  липсващи метрики")
    for row in summary:
        c = json.loads((DATA / "companies" / f"{row['ticker']}.json").read_text())
        gaps = [m for m in metrics if c["latest"].get(m) is None]
        missing.update(gaps)
        port = c.get("portfolio") or {}
        cov = port.get("coverage")
        cov_txt = f"{cov:.0%}" if cov else "—"
        total = f"{row['total']:.0f}" if row["total"] is not None else "—"
        print(f"{row['ticker']:6} {total:>5} {row['light'] or '—':7} {cov_txt:>6}  {', '.join(gaps)}")
    print("\nНай-често липсващи:", ", ".join(f"{m} ({n})" for m, n in missing.most_common()))

    other = Counter()
    for path in (sec.CACHE / "portfolio").glob("*.json"):
        data = json.loads(path.read_text())
        for row in data.get("rows", []):
            if portfolio.type_group(row[1]) == "other":
                other[row[1]] += 1
    if other:
        print("\nНемапнати типове инвестиции (config/investment_types.yaml):")
        for name, n in other.most_common(25):
            print(f"  {n:5d}  {name}")


if __name__ == "__main__":
    main()
