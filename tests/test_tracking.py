from __future__ import annotations

import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_tracking", ROOT / "scripts" / "build-tracking.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def micros(iso: str) -> str:
    return str(int(datetime.fromisoformat(iso).timestamp() * 1_000_000))


def event(day: str, name: str = "page_view", host: str = "familyheirloomstorage.com", uid: str = "u1", hour: int = 16) -> dict:
    return {"user_pseudo_id": uid, "event_timestamp": micros(f"{day}T{hour:02d}:00:00+00:00"), "event_name": name, "host": host}


def inputs(events, google_days=None, leads=None, through="2026-09-30", sources_rows=None):
    google_days = google_days or []
    ga4 = {"start": "2026-09-01", "through": through, "events": events}
    google = [{"segments.date": d, "metrics.clicks": c, "metrics.conversions": v} for d, c, v in google_days]
    meta = {"through": through, "leads": leads or []}
    sources = {"cutoff": through, "rows": sources_rows or []}
    reporting = {"periods": [{"id": "2026-09", "start": "2026-09-01", "end": through, "facilities": [{"id": "1", "moveIns": 3}]}]}
    return ga4, google, meta, sources, reporting


def steady(days: range, per_day: int, name: str = "page_view") -> list[dict]:
    return [event(f"2026-09-{d:02d}", name, uid=f"u{d}-{n}") for d in days for n in range(per_day)]


def test_eastern_dates_follow_daylight_saving():
    assert builder.eastern_date(datetime(2026, 9, 30, 3, 59, tzinfo=timezone.utc)) == "2026-09-29"  # EDT, UTC-4
    assert builder.eastern_date(datetime(2026, 9, 30, 4, 0, tzinfo=timezone.utc)) == "2026-09-30"
    assert builder.eastern_date(datetime(2026, 12, 1, 4, 59, tzinfo=timezone.utc)) == "2026-11-30"  # EST, UTC-5
    assert builder.eastern_date(datetime(2026, 11, 1, 5, 59, tzinfo=timezone.utc)) == "2026-11-01"  # still EDT at 01:59
    assert builder.eastern_date(datetime(2026, 3, 8, 6, 59, tzinfo=timezone.utc)) == "2026-03-08"  # still EST at 01:59
    assert builder.parse_time("2026-06-20T20:05:51+0000") == datetime(2026, 6, 20, 20, 5, 51, tzinfo=timezone.utc)


def test_outage_is_flagged_once_and_low_volume_signals_never_are():
    events = steady(range(1, 21), 30) + steady(range(24, 31), 30)  # Sep 21-23 dark
    events += [event(f"2026-09-{d:02d}", "form_submit") for d in (2, 9, 16)]  # sparse signal with zero days
    out = builder.build(*inputs(events))
    flags = {(f["series"], f["from"], f["to"]) for f in out["flags"]}
    assert flags == {("pageViews", "2026-09-21", "2026-09-23")}
    flag = out["flags"][0]
    assert flag["days"] == 3 and flag["lowest"] == 0 and flag["typical"] == 30


def test_flagged_days_do_not_lower_the_baseline():
    events = steady(range(1, 15), 40) + steady(range(15, 30), 1)  # a long collapse stays flagged
    out = builder.build(*inputs(events, through="2026-09-30"))
    page = [f for f in out["flags"] if f["series"] == "pageViews"]
    assert len(page) == 1 and page[0]["from"] == "2026-09-15" and page[0]["typical"] == 40


def test_days_after_the_last_export_are_not_zero():
    events = steady(range(1, 29), 20)  # export delivered through the 28th; cutoff is the 30th
    out = builder.build(*inputs(events, google_days=[("2026-09-29", 12, 2.0)]))
    by_day = {d["date"]: d for d in out["days"]}
    assert out["coverage"]["ga4"]["lastExportedDay"] == "2026-09-28"
    assert by_day["2026-09-29"]["pageViews"] is None and by_day["2026-09-30"]["pageViews"] is None
    assert by_day["2026-09-29"]["googleClicks"] == 12 and by_day["2026-09-30"]["googleClicks"] == 0
    assert not out["flags"]
    month = out["months"][0]
    assert month["ga4Days"] == 28 and month["days"] == 30


def test_funnel_counts_distinct_visitors_and_ccstorage_online_move_ins():
    events = [event("2026-09-02", uid="a"), event("2026-09-03", uid="a"), event("2026-09-03", "begin_checkout", uid="a"),
              event("2026-09-04", uid="b"), event("2026-09-04", "page_view", host="x.ccstorage.com", uid="c"),
              event("2026-09-05", "ccstorage_rental_completed", host="x.ccstorage.com", uid="c")]
    rows = [{"move_in_date": "2026-09-05", "online": True}, {"move_in_date": "2026-09-06", "online": False}]
    out = builder.build(*inputs(events, sources_rows=rows))
    month = out["months"][0]
    assert (month["visitors"], month["checkoutVisitors"], month["rentalEvents"], month["onlineMoveIns"], month["moveIns"]) == (2, 1, 1, 1, 3)
    by_day = {d["date"]: d for d in out["days"]}
    assert by_day["2026-09-04"]["portalPageViews"] == 1 and by_day["2026-09-04"]["pageViews"] == 1


def test_meta_leads_counted_on_eastern_dates():
    leads = [{"created_time": "2026-09-10T02:00:00+0000"}, {"created_time": "2026-09-10T15:00:00+0000"}]
    out = builder.build(*inputs(steady(range(1, 31), 1), leads=leads))
    by_day = {d["date"]: d for d in out["days"]}
    assert by_day["2026-09-09"]["metaLeads"] == 1 and by_day["2026-09-10"]["metaLeads"] == 1


@pytest.mark.parametrize("field", ["sources", "ga4", "meta"])
def test_cutoff_mismatch_aborts(field):
    ga4, google, meta, sources, reporting = inputs(steady(range(1, 31), 1))
    {"sources": sources, "ga4": ga4, "meta": meta}[field].update({"cutoff": "2026-09-29", "through": "2026-09-29"})
    with pytest.raises(builder.TrackingError):
        builder.build(ga4, google, meta, sources, reporting)


def test_output_holds_counts_only():
    out = builder.build(*inputs([event("2026-09-02", uid="secret-browser-id")]))
    text = json.dumps(out)
    assert "secret-browser-id" not in text and "familyheirloomstorage.com" not in text
