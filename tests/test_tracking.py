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


@pytest.fixture
def portal_fixture():
    return json.loads((ROOT / "tests/fixtures/tracking-portal-ad-source.json").read_text(encoding="utf-8"))


def build_portal(ga4):
    args = list(inputs([], through=ga4["through"]))
    args[0] = ga4
    args[4]["periods"] = [{"id": "2026-10", "start": "2026-10-01", "end": ga4["through"], "facilities": []}]
    return builder.build(*args)


def test_portal_session_rollup_and_verbatim_source_breakdown(portal_fixture):
    out = build_portal(portal_fixture["ga4"])
    assert out["portalAdSource"] == portal_fixture["expected"]
    # The same session ID on two browsers is two sessions; a new session on the same browser is direct.
    assert sum(r["rentalEvents"] for r in out["portalAdSource"]["rentalsBySource"]) == 3
    portal_fixture["ga4"]["events"].reverse()
    assert build_portal(portal_fixture["ga4"])["portalAdSource"] == out["portalAdSource"]


@pytest.mark.parametrize("signal, click_id", [({"has_gclid": True}, "gclid"), ({"has_fbclid": True}, "fbclid")])
def test_any_event_in_the_session_can_supply_an_ad_click(signal, click_id):
    events = [dict(event("2026-10-29", "ccstorage_rental_completed", "x.ccstorage.com"), ga_session_id="synthetic-session"),
              dict(event("2026-10-29", hour=17), ga_session_id="synthetic-session", **signal)]
    section = build_portal({"start": "2026-10-28", "through": "2026-10-30", "events": events})["portalAdSource"]
    assert section["days"][0]["portalSessionsWithAdClick"] == 1
    assert section["days"][0]["rentalCompletedEventsWithAdClick"] == 1
    assert section["rentalsBySource"] == [{"clickId": click_id, "source": None,
                                           "medium": None, "campaign": None, "rentalEvents": 1}]


@pytest.mark.parametrize("uid", ["fixture-internal", "fixture-organic"])
def test_fixture_internal_and_organic_sessions_are_not_ad_clicks(portal_fixture, uid):
    ga4 = portal_fixture["ga4"]
    ga4["events"] = [row for row in ga4["events"] if row["user_pseudo_id"] == uid]
    section = build_portal(ga4)["portalAdSource"]
    assert section["days"][0] == {"date": "2026-10-29", "portalSessions": 1, "portalSessionsWithAdClick": 0,
                                  "rentalCompletedEvents": 1, "rentalCompletedEventsWithAdClick": 0}
    assert section["rentalsBySource"] == []


@pytest.mark.parametrize("source, medium", [("chatgpt.com", "referral"), ("familyheirloomstorage.com", "referral"),
                                          ("GBPListings", "organic"), ("bing", "organic"), ("yahoo", "organic"),
                                          ("google", "cpc")])
def test_source_and_medium_never_qualify_without_a_click_id(source, medium):
    events = [dict(event("2026-10-29", "ccstorage_rental_completed", "x.ccstorage.com"), ga_session_id="labels-only",
                   utm_source=source, utm_medium=medium, manual_source=source, manual_medium=medium)]
    section = build_portal({"start": "2026-10-29", "through": "2026-10-29", "events": events})["portalAdSource"]
    assert section["days"][0]["portalSessionsWithAdClick"] == 0
    assert section["days"][0]["rentalCompletedEventsWithAdClick"] == 0
    assert section["rentalsBySource"] == []


@pytest.mark.parametrize("labels, expected", [
    ({"utm_source": " Exact UTM ", "utm_medium": "Paid Search", "utm_campaign": "<Fall>",
      "manual_source": "Other", "manual_medium": "organic", "manual_campaign": "Other campaign"},
     (" Exact UTM ", "Paid Search", "<Fall>")),
    ({"utm_source": "UTM", "manual_source": "Other", "manual_medium": "cpc", "manual_campaign": "Fallback"},
     ("UTM", "cpc", "Fallback")),
    ({"utm_source": " ccstorage ", "utm_medium": "LINK", "manual_source": "google", "manual_medium": "cpc"},
     ("google", "cpc", None)),
    ({"manual_source": "ccstorage", "manual_medium": "link"}, (None, None, None)),
    ({"utm_source": "link", "utm_medium": "ccstorage", "utm_campaign": "ccstorage"},
     ("link", "ccstorage", "ccstorage")),
])
def test_utm_precedence_and_internal_label_filter_are_per_field(labels, expected):
    events = [dict(event("2026-10-29", "ccstorage_rental_completed", "x.ccstorage.com"),
                   ga_session_id="label-precedence", has_gclid=True, **labels)]
    section = build_portal({"start": "2026-10-29", "through": "2026-10-29", "events": events})["portalAdSource"]
    assert section["rentalsBySource"] == [{"clickId": "gclid", "source": expected[0], "medium": expected[1],
                                          "campaign": expected[2], "rentalEvents": 1}]


def test_breakdown_groups_by_click_id_and_both_flags_count_once():
    events = []
    for click_id in ("gclid", "fbclid", "gclid+fbclid"):
        # Both flags can occur on different events; labels are identical in all three sessions.
        for flag in click_id.split("+"):
            events.append(dict(event("2026-10-29", uid=click_id), ga_session_id="shared-id",
                               utm_source="Same", utm_medium="Paid", utm_campaign="Campaign", **{"has_" + flag: True}))
        events.append(dict(event("2026-10-29", "ccstorage_rental_completed", "x.ccstorage.com", uid=click_id),
                           ga_session_id="shared-id"))
    section = build_portal({"start": "2026-10-29", "through": "2026-10-29", "events": events})["portalAdSource"]
    assert section["days"][0]["portalSessionsWithAdClick"] == 3
    assert section["days"][0]["rentalCompletedEventsWithAdClick"] == 3
    assert section["rentalsBySource"] == [{"clickId": click_id, "source": "Same", "medium": "Paid",
                                          "campaign": "Campaign", "rentalEvents": 1}
                                         for click_id in ("fbclid", "gclid", "gclid+fbclid")]


@pytest.mark.parametrize("field", ["utm_campaign", "manual_campaign", "first_campaign"])
@pytest.mark.parametrize("campaign", ["owner_test", "owner_test_live", "owner_test_extra"])
def test_owner_tests_are_excluded_from_every_ga4_count_and_keep_export_coverage(field, campaign):
    events = [dict(event("2026-10-29", "ccstorage_rental_completed", "x.ccstorage.com"), ga_session_id="test-session"),
              dict(event("2026-10-29", "begin_checkout"), ga_session_id="test-session"),
              dict(event("2026-10-29", hour=18), ga_session_id="test-session", **{field: campaign})]
    out = build_portal({"start": "2026-10-28", "through": "2026-10-30", "events": events})
    assert out["coverage"]["ga4"]["lastExportedDay"] == "2026-10-29"
    assert out["portalAdSource"]["testSessionsExcluded"] == 1
    assert not out["portalAdSource"]["rentalsBySource"]
    assert all(value == 0 for key, value in out["portalAdSource"]["days"][0].items() if key != "date")
    assert all(value is None for key, value in out["portalAdSource"]["days"][1].items() if key != "date")
    heartbeat = next(row for row in out["days"] if row["date"] == "2026-10-29")
    assert all(heartbeat[key] == 0 for key, _, source in builder.SERIES if source == "ga4")
    assert all(out["months"][0][key] == 0 for key in ("visitors", "checkoutVisitors", "rentalEvents"))


def test_baseline_is_computed_and_test_sessions_excluded(portal_fixture):
    portal_fixture["ga4"]["events"][0]["has_fbclid"] = True
    out = build_portal(portal_fixture["ga4"])
    baseline = out["portalAdSource"]["baseline"]
    assert (baseline["portalEvents"], baseline["portalEventsWithClickId"]) == (3, 1)
    assert (baseline["portalEventsWithGclid"], baseline["portalEventsWithFbclid"]) == (0, 1)
    assert out["months"][0]["rentalEvents"] == 7
    assert out["months"][0]["checkoutVisitors"] == 0
    assert out["months"][0]["visitors"] == 1


def test_prelaunch_export_has_null_postlaunch_days(portal_fixture):
    ga4 = portal_fixture["ga4"]
    ga4["events"] = ga4["events"][:4]
    section = build_portal(ga4)["portalAdSource"]
    assert len(section["days"]) == 3
    assert all(value is None for row in section["days"] for key, value in row.items() if key != "date")
    assert section["rentalsBySource"] == []
    ga4["through"] = "2026-10-28"
    assert build_portal(ga4)["portalAdSource"]["days"] == []


def test_sessions_crossing_eastern_midnight_count_once_and_rentals_on_event_day():
    events = [dict(event("2026-10-29", host="x.ccstorage.com"), ga_session_id="crossing", has_gclid=True),
              dict(event("2026-10-30", "ccstorage_rental_completed", "x.ccstorage.com"), ga_session_id="crossing")]
    section = build_portal({"start": "2026-10-29", "through": "2026-10-30", "events": events})["portalAdSource"]
    assert [day["portalSessions"] for day in section["days"]] == [1, 0]
    assert [day["rentalCompletedEventsWithAdClick"] for day in section["days"]] == [0, 1]
    assert section["baseline"]["portalEvents"] is None


def test_missing_session_keys_do_not_merge_unrelated_events():
    events = [dict(event("2026-10-29", host="x.ccstorage.com", uid=None), has_gclid=True),
              event("2026-10-29", "ccstorage_rental_completed", "x.ccstorage.com", uid=None)]
    section = build_portal({"start": "2026-10-29", "through": "2026-10-29", "events": events})["portalAdSource"]
    assert section["days"] == [{"date": "2026-10-29", "portalSessions": 0, "portalSessionsWithAdClick": 0,
                                "rentalCompletedEvents": 1, "rentalCompletedEventsWithAdClick": 0}]


@pytest.mark.parametrize("prefix", ["utm", "manual"])
def test_conflicting_labels_are_not_resolved_as_first_or_last_touch(prefix):
    events = [dict(event("2026-10-29", host="x.ccstorage.com"), ga_session_id="conflict", has_gclid=True,
                   **{prefix + "_source": "One", prefix + "_campaign": "A"}),
              dict(event("2026-10-29", "ccstorage_rental_completed", "x.ccstorage.com", hour=17), ga_session_id="conflict",
                   **{prefix + "_source": "Two", prefix + "_campaign": "B"})]
    if prefix == "utm":
        events[0].update(manual_source="Fallback must not resolve conflicting UTMs", manual_campaign="Fallback")
    section = build_portal({"start": "2026-10-29", "through": "2026-10-29", "events": events})["portalAdSource"]
    assert section["rentalsBySource"] == [{"clickId": "gclid", "source": None, "medium": None, "campaign": None, "rentalEvents": 1}]


def test_portal_output_contains_no_identifiers_or_event_timestamps(portal_fixture):
    out = build_portal(portal_fixture["ga4"])
    text = json.dumps(out)
    for event_row in portal_fixture["ga4"]["events"]:
        for field in ("user_pseudo_id", "ga_session_id", "event_timestamp", "host"):
            assert field not in text
            assert event_row[field] not in text
    assert "owner_test" not in text
