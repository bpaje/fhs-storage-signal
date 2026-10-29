from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_restatements", ROOT / "scripts" / "build-restatements.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def snapshot(extracted="2026-10-27T06:00:00+00:00", oct_end="2026-10-26"):
    facility = lambda fid, net, ins, outs: {"id": fid, "name": f"Facility {fid}", "net": net, "moveIns": ins, "moveOuts": outs}
    month = lambda pid, start, end, partial: {"id": pid, "label": pid, "start": start, "end": end, "partial": partial,
                                              "google": {"spend": 100.0, "conversions": 5.0}, "meta": {"spend": 50.0, "leads": 3.0},
                                              "reportingViewVolume": 900.0, "facilities": [facility("1", 600.0, 2, 1), facility("2", 400.0, 1, 1)]}
    return {"schema": "storage-signal.reporting.v1", "refreshed": extracted[:10], "ccExtractedAt": extracted,
            "periods": [month("2026-09", "2026-09-01", "2026-09-30", False), month("2026-10", "2026-10-01", oct_end, True)]}


def test_unchanged_history_and_extended_month():
    old, new = snapshot(), snapshot("2026-10-29T09:00:00+00:00", "2026-10-28")
    new["periods"][1]["google"]["spend"] = 140.0
    out = builder.build(old, new)
    sep, oct_ = out["months"]
    assert sep["status"] == "unchanged" and not sep["changes"]
    assert oct_["status"] == "extended" and oct_["facilities"] == []  # a longer month is not a restatement
    assert out["previous"]["cutoff"] == "2026-10-26" and out["current"]["cutoff"] == "2026-10-28"


def test_revised_complete_month_lists_portfolio_and_facility_changes():
    old, new = snapshot(), snapshot("2026-10-29T09:00:00+00:00", "2026-10-28")
    new["periods"][0]["facilities"][0]["net"] = 587.32
    new["periods"][0]["facilities"][1]["moveOuts"] = 3
    out = builder.build(old, new)
    sep = out["months"][0]
    assert sep["status"] == "restated"
    changes = {c["metric"]: c for c in sep["changes"]}
    assert set(changes) == {"net", "moveOuts"}
    assert changes["net"]["previous"] == 1000.0 and changes["net"]["current"] == 987.32 and changes["net"]["difference"] == pytest.approx(-12.68)
    assert changes["moveOuts"]["difference"] == 2
    assert {(f["id"], f["metric"]) for f in sep["facilities"]} == {("1", "net"), ("2", "moveOuts")}


def test_sub_cent_noise_is_not_a_restatement():
    old, new = snapshot(), snapshot("2026-10-29T09:00:00+00:00")
    new["periods"][0]["google"]["spend"] = 100.004
    assert builder.build(old, new)["months"][0]["status"] == "unchanged"


def test_new_month_and_same_snapshot_guard():
    old = snapshot()
    new = copy.deepcopy(old)
    with pytest.raises(SystemExit):
        builder.build(old, new)
    new = snapshot("2026-11-02T09:00:00+00:00", "2026-10-31")
    new["periods"].append({**copy.deepcopy(new["periods"][1]), "id": "2026-11", "label": "2026-11", "start": "2026-11-01", "end": "2026-11-01"})
    assert builder.build(old, new)["months"][-1]["status"] == "new"


def test_null_history_becoming_available_is_reported():
    old, new = snapshot(), snapshot("2026-10-29T09:00:00+00:00")
    old["periods"][0]["reportingViewVolume"] = None
    change = builder.build(old, new)["months"][0]["changes"][0]
    assert change["metric"] == "reportingViewVolume" and change["previous"] is None and change["difference"] is None
