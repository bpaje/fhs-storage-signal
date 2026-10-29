#!/usr/bin/env python3
"""Compare this reporting snapshot with the previous published one and record every revised past value.

Answers the auditor question "what changed in history since the last refresh?". Sources revise history (late
ACH returns, voided leases, platform conversion updates), so each refresh is a dated snapshot. A month whose end
date moved forward (month to date extended) is marked "extended", not restated. Facility rows are compared only for
complete months that both snapshots cover. Output holds public aggregates only (data/restatements.json).

Usage: py -3.14 scripts/build-restatements.py <previous-reporting.json | git:REV> [current-reporting.json] [out.json]
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = "storage-signal.restatements.v1"
MONEY_TOLERANCE = 0.005
COUNT_TOLERANCE = 1e-6
PORTFOLIO = [
    ("google.spend", "Google Ads spend", "money"),
    ("google.conversions", "Google Ads conversions", "number"),
    ("meta.spend", "Meta Ads spend", "money"),
    ("meta.leads", "Meta leads", "number"),
    ("net", "Net recorded payments", "money"),
    ("moveIns", "Move-ins", "number"),
    ("moveOuts", "Move-outs", "number"),
    ("reportingViewVolume", "CCStorage reporting-view volume", "money"),
]
FACILITY = [("net", "Net recorded payments", "money"), ("moveIns", "Move-ins", "number"), ("moveOuts", "Move-outs", "number")]


class SameSnapshot(SystemExit):
    pass


def value(period: dict[str, Any], key: str) -> float | None:
    if key in ("net", "moveIns", "moveOuts"):
        values = [f[key] for f in period["facilities"] if f.get(key) is not None]
        return round(sum(values), 2) if values else None
    node: Any = period
    for part in key.split("."):
        node = node.get(part) if isinstance(node, dict) else None
    return node


def changed(old: float | None, new: float | None, kind: str) -> bool:
    if old is None or new is None:
        return old is not new
    return abs(new - old) > (MONEY_TOLERANCE if kind == "money" else COUNT_TOLERANCE)


def change(key: str, label: str, kind: str, old: float | None, new: float | None) -> dict[str, Any]:
    diff = None if old is None or new is None else round(new - old, 6)
    return {"metric": key, "label": label, "kind": kind, "previous": old, "current": new, "difference": diff}


def build(previous: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    if previous.get("schema") != current.get("schema"):
        raise SystemExit("snapshot schemas differ; compare like with like")
    if previous.get("ccExtractedAt") == current.get("ccExtractedAt") and previous.get("refreshed") == current.get("refreshed"):
        raise SameSnapshot("previous and current are the same snapshot")
    old_periods = {p["id"]: p for p in previous["periods"]}
    months = []
    for period in current["periods"]:
        old = old_periods.get(period["id"])
        if not old:
            months.append({"id": period["id"], "label": period["label"], "status": "new", "changes": [], "facilities": []})
            continue
        extended = old["end"] != period["end"]
        changes = [change(k, l, kind, value(old, k), value(period, k)) for k, l, kind in PORTFOLIO if changed(value(old, k), value(period, k), kind)]
        facilities = []
        if not extended:
            names = {f["id"]: f["name"] for f in period["facilities"]}
            before = {f["id"]: f for f in old["facilities"]}
            for f in period["facilities"]:
                prior = before.get(f["id"], {})
                for k, l, kind in FACILITY:
                    if changed(prior.get(k), f.get(k), kind):
                        facilities.append({"id": f["id"], "name": names[f["id"]], **change(k, l, kind, prior.get(k), f.get(k))})
        months.append({
            "id": period["id"], "label": period["label"],
            "status": "extended" if extended else ("restated" if changes or facilities else "unchanged"),
            "previousEnd": old["end"], "currentEnd": period["end"],
            "changes": changes, "facilities": facilities,
        })
    return {
        "schema": SCHEMA,
        "previous": {"refreshed": previous.get("refreshed"), "ccExtractedAt": previous.get("ccExtractedAt"), "cutoff": previous["periods"][-1]["end"]},
        "current": {"refreshed": current.get("refreshed"), "ccExtractedAt": current.get("ccExtractedAt"), "cutoff": current["periods"][-1]["end"]},
        "tolerance": {"money": MONEY_TOLERANCE, "count": COUNT_TOLERANCE},
        "months": months,
    }


def read_snapshot(source: str) -> dict[str, Any]:
    """A file path, or git:<rev> for data/reporting.json as committed at that revision (the last published snapshot)."""
    if source.startswith("git:"):
        text = subprocess.run(["git", "-C", str(ROOT), "show", f"{source[4:]}:data/reporting.json"], check=True, capture_output=True).stdout.decode("utf-8")
        return json.loads(text)
    return json.loads(Path(source).read_text(encoding="utf-8"))


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        raise SystemExit(__doc__)
    current = argv[2] if len(argv) > 2 else str(ROOT / "data" / "reporting.json")
    out = Path(argv[3]) if len(argv) > 3 else ROOT / "data" / "restatements.json"
    try:
        result = build(read_snapshot(argv[1]), read_snapshot(current))
    except SameSnapshot:
        if out.exists():  # a rerun with no new extraction: the last comparison still stands
            print(f"same snapshot as {argv[1]}; {out} left unchanged")
            return
        raise
    out.write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    summary = ", ".join(f"{m['id']} {m['status']}" for m in result["months"])
    print(f"wrote {out}: {summary}")


if __name__ == "__main__":
    main(sys.argv)
