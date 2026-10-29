#!/usr/bin/env python3
"""Build the private tracking heartbeat and website funnel file (data/restricted/tracking.json).

Answers "is tracking still firing every day?" and "is the website turning visitors into rentals?".
Daily counts per signal, in America/New_York dates (the GA4 property and Google Ads account time zone):
  GA4 BigQuery export   page views, checkout starts, form submissions, contact events (main site),
                        rental-portal page views (ccstorage.com hosts), rental-completed events (any host)
  Google Ads daily      clicks and conversions (google-report.json)
  Meta lead forms       lead records by created time (meta-leads-source.json)

A day is flagged only when its signal normally runs at least FLAG_MIN_TYPICAL a day (median of the previous
TYPICAL_DAYS covered days) and falls below FLAG_RATIO of that. Days after the last day the GA4 export delivered
are "not exported yet", never zero. The monthly funnel counts distinct GA4 pseudonymous ids; it never links
visitors to renters. Portal ad-click reporting is separately labeled GA4 evidence, never renter credit.
Output holds aggregate counts and sanitized source labels: no visitor/session ids, event timestamps or pages.

Usage: py -3.14 scripts/build-tracking.py [ga4-events.json] [google-report.json] [meta-leads.json] [sources.json] [reporting.json] [out.json]
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / "private-scripts"
SCHEMA = "storage-signal.tracking.v1"
MAIN_HOST = "familyheirloomstorage.com"
PORTAL_SUFFIX = ".ccstorage.com"
# The iframe began receiving click IDs and UTM parameters on this America/New_York date.
PORTAL_AD_SOURCE_LIVE_FROM = "2026-10-29"
TYPICAL_DAYS = 14
MIN_TYPICAL_DAYS = 7
FLAG_MIN_TYPICAL = 10
FLAG_RATIO = 0.25
SERIES = [
    ("pageViews", "Website page views", "ga4"),
    ("checkoutStarts", "Checkout starts", "ga4"),
    ("formSubmits", "Form submissions", "ga4"),
    ("contacts", "Contact events", "ga4"),
    ("portalPageViews", "Rental portal page views", "ga4"),
    ("rentalsCompleted", "Rentals completed (GA4 event)", "ga4"),
    ("googleClicks", "Google Ads clicks", "google"),
    ("googleConversions", "Google Ads conversions", "google"),
    ("metaLeads", "Meta lead records", "meta"),
]
GA4_EVENTS = {"page_view": "pageViews", "begin_checkout": "checkoutStarts", "form_submit": "formSubmits", "contact": "contacts"}


class TrackingError(SystemExit):
    pass


def first_sunday(year: int, month: int) -> date:
    day = date(year, month, 1)
    return day + timedelta(days=(6 - day.weekday()) % 7)


def eastern_date(moment: datetime) -> str:
    """US Eastern calendar date (DST from the second Sunday in March 2:00 to the first Sunday in November 2:00)."""
    moment = moment.astimezone(timezone.utc)
    year = moment.year
    dst_start = datetime.combine(first_sunday(year, 3) + timedelta(days=7), datetime.min.time(), timezone.utc) + timedelta(hours=7)
    dst_end = datetime.combine(first_sunday(year, 11), datetime.min.time(), timezone.utc) + timedelta(hours=6)
    offset = -4 if dst_start <= moment < dst_end else -5
    return (moment + timedelta(hours=offset)).date().isoformat()


def parse_time(text: str) -> datetime:
    if text.isdigit():
        return datetime.fromtimestamp(int(text) / 1_000_000, tz=timezone.utc)
    if len(text) > 5 and text[-5] in "+-" and text[-3] != ":":
        text = text[:-2] + ":" + text[-2:]
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def days_between(start: str, end: str) -> list[str]:
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    return [(first + timedelta(days=n)).isoformat() for n in range((last - first).days + 1)]


def read(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise TrackingError(f"missing input: {path}") from error


def session_key(event: dict[str, Any]) -> tuple[str, str] | None:
    uid, sid = event.get("user_pseudo_id"), event.get("ga_session_id")
    return (str(uid), str(sid)) if uid not in (None, "") and sid not in (None, "") else None


def is_owner_test(event: dict[str, Any]) -> bool:
    return any(str(event.get(field) or "").startswith("owner_test")
               for field in ("utm_campaign", "manual_campaign", "first_campaign"))


def excluded_sessions(events: list[dict[str, Any]]) -> set[tuple[str, str]]:
    return {key for event in events if is_owner_test(event) and (key := session_key(event)) is not None}


def excluded_event(event: dict[str, Any], excluded: set[tuple[str, str]]) -> bool:
    # A tagged event without a complete session key is excluded too, but cannot count as a session.
    return is_owner_test(event) or session_key(event) in excluded


def ga4_counts(events_file: dict[str, Any], excluded: set[tuple[str, str]]) -> tuple[dict[str, Counter], dict[str, dict[str, set]], str | None]:
    daily: dict[str, Counter] = defaultdict(Counter)
    users: dict[str, dict[str, set]] = defaultdict(lambda: defaultdict(set))
    last = None
    for event in events_file["events"]:
        day = eastern_date(parse_time(str(event["event_timestamp"])))
        # Test-only days still establish export coverage; filtering must not move this date back.
        last = max(last or day, day)
        if excluded_event(event, excluded):
            continue
        name, host, uid = event["event_name"], (event.get("host") or "").lower(), event.get("user_pseudo_id")
        month = users[day[:7]]
        if name == "ccstorage_rental_completed":
            daily[day]["rentalsCompleted"] += 1
        if host == MAIN_HOST:
            if name in GA4_EVENTS:
                daily[day][GA4_EVENTS[name]] += 1
            if uid:
                month["visitors"].add(uid)
                if name == "begin_checkout":
                    month["checkout"].add(uid)
        elif host.endswith(PORTAL_SUFFIX) and name == "page_view":
            daily[day]["portalPageViews"] += 1
    return daily, users, last


def portal_ad_source(ga4: dict[str, Any], cutoff: str, last: str | None,
                     excluded: set[tuple[str, str]]) -> dict[str, Any]:
    """Session evidence only, with no cross-session attribution or join to CCStorage leases.

    Sessions count once, on their first portal event's Eastern day; rentals on their own event day.
    Only gclid/fbclid flags qualify a session. Labels prefer usable UTM values per field, falling back
    to manual values only when no usable UTM value exists. Conflicting labels stay null.
    """
    live = PORTAL_AD_SOURCE_LIVE_FROM
    baseline_end = min(last, (date.fromisoformat(live) - timedelta(days=1)).isoformat()) if last else None
    baseline_covered = baseline_end is not None and ga4["start"] <= baseline_end
    baseline = {"start": ga4["start"], "through": baseline_end if baseline_covered else None,
                **{key: 0 if baseline_covered else None for key in
                   ("portalEvents", "portalEventsWithClickId", "portalEventsWithGclid", "portalEventsWithFbclid")}}
    sessions: dict[tuple[str, str], dict[str, Any]] = {}
    rentals = []
    daily: dict[str, Counter] = defaultdict(Counter)
    for event in ga4["events"]:
        if excluded_event(event, excluded):
            continue
        day = eastern_date(parse_time(str(event["event_timestamp"])))
        portal = (event.get("host") or "").lower().endswith(PORTAL_SUFFIX)
        click_id = bool(event.get("has_gclid") or event.get("has_fbclid"))
        if portal and baseline_covered and ga4["start"] <= day < live:
            baseline["portalEvents"] += 1
            baseline["portalEventsWithClickId"] += int(click_id)
            # Kept apart: before launch, Meta ads already linked straight to the portal; Google clicks never arrived.
            baseline["portalEventsWithGclid"] += int(bool(event.get("has_gclid")))
            baseline["portalEventsWithFbclid"] += int(bool(event.get("has_fbclid")))
        key = session_key(event)
        if key is not None:
            session = sessions.setdefault(key, {"portalDay": None, "clickIds": set(),
                                                "utm": defaultdict(set), "manual": defaultdict(set)})
            if portal:
                session["portalDay"] = min(session["portalDay"] or day, day)
            session["clickIds"].update(flag for flag in ("gclid", "fbclid") if event.get("has_" + flag))
            for field in ("source", "medium", "campaign"):
                for prefix in ("utm", "manual"):
                    value = event.get(prefix + "_" + field)
                    if value not in (None, ""):
                        if (field, value.strip().lower()) in (("source", "ccstorage"), ("medium", "link")):
                            continue  # CCStorage's internal navigation is not an arrival label.
                        session[prefix][field].add(value)  # already sanitized; preserve spelling and case exactly
        if event["event_name"] == "ccstorage_rental_completed" and live <= day <= cutoff:
            rentals.append((day, key))

    for session in sessions.values():
        day = session["portalDay"]
        if day and live <= day <= cutoff:
            daily[day]["portalSessions"] += 1
            daily[day]["portalSessionsWithAdClick"] += int(bool(session["clickIds"]))
    breakdown: Counter = Counter()
    for day, key in rentals:
        daily[day]["rentalCompletedEvents"] += 1
        session = sessions.get(key)
        if session and session["clickIds"]:
            daily[day]["rentalCompletedEventsWithAdClick"] += 1
            labels = []
            for field in ("source", "medium", "campaign"):
                values = session["utm"][field] or session["manual"][field]
                labels.append(next(iter(values)) if len(values) == 1 else None)
            click_ids = "+".join(flag for flag in ("gclid", "fbclid") if flag in session["clickIds"])
            breakdown[(click_ids, *labels)] += 1
    metrics = ("portalSessions", "portalSessionsWithAdClick", "rentalCompletedEvents", "rentalCompletedEventsWithAdClick")
    rows = []
    for day in days_between(live, cutoff):
        covered = ga4["start"] <= day <= (last or "")
        rows.append({"date": day, **{key: daily[day][key] if covered else None for key in metrics}})
    return {
        "liveFrom": live,
        "baseline": baseline,
        "days": rows,
        "rentalsBySource": [{"clickId": labels[0], "source": labels[1], "medium": labels[2], "campaign": labels[3], "rentalEvents": count}
                            for labels, count in sorted(breakdown.items(), key=lambda item: tuple(v or "" for v in item[0]))],
        "testSessionsExcluded": len(excluded),
    }


def flag_runs(days: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flags = []
    for key, label, _ in SERIES:
        history: list[float] = []
        run = None
        for row in days:
            value = row[key]
            if value is None:
                continue
            typical = median(history[-TYPICAL_DAYS:]) if len(history) >= MIN_TYPICAL_DAYS else None
            low = typical is not None and typical >= FLAG_MIN_TYPICAL and value < FLAG_RATIO * typical
            if low:
                if run:
                    run.update(to=row["date"], days=run["days"] + 1, lowest=min(run["lowest"], value))
                else:
                    run = {"series": key, "label": label, "from": row["date"], "to": row["date"], "days": 1, "lowest": value, "typical": round(typical, 1)}
                    flags.append(run)
            else:
                run = None
                history.append(value)  # a flagged day never lowers the baseline it is judged against
    return sorted(flags, key=lambda f: (f["from"], f["series"]))


def build(ga4: dict[str, Any], google: list[dict[str, Any]], meta: dict[str, Any], sources: dict[str, Any], reporting: dict[str, Any]) -> dict[str, Any]:
    periods = reporting["periods"]
    cutoff = periods[-1]["end"]
    if sources["cutoff"] != cutoff:
        raise TrackingError(f"sources cutoff {sources['cutoff']} != reporting cutoff {cutoff}")
    for name, through in (("GA4 events", ga4["through"]), ("Meta leads", meta["through"])):
        if through != cutoff:
            raise TrackingError(f"{name} fetched through {through}, reporting cutoff is {cutoff}")
    excluded = excluded_sessions(ga4["events"])
    ga4_daily, ga4_users, ga4_last = ga4_counts(ga4, excluded)
    google_by_day = {row["segments.date"]: row for row in google}
    meta_daily = Counter(eastern_date(parse_time(lead["created_time"])) for lead in meta["leads"])
    google_start = min(google_by_day) if google_by_day else cutoff

    rows = []
    for day in days_between(periods[0]["start"], cutoff):
        ga4_covered = ga4["start"] <= day <= (ga4_last or "")
        google_row = google_by_day.get(day)
        row = {"date": day}
        for key, _, source in SERIES:
            if source == "ga4":
                row[key] = ga4_daily[day][key] if ga4_covered else None
            elif source == "google":
                field = "metrics.clicks" if key == "googleClicks" else "metrics.conversions"
                row[key] = round(float(google_row[field]), 2) if google_row else (0 if day >= google_start else None)
            else:
                row[key] = meta_daily[day]
        rows.append(row)

    online = Counter(r["move_in_date"][:7] for r in sources["rows"] if r["online"])
    months = []
    for period in periods:
        month = period["id"]
        covered = [d for d in days_between(period["start"], period["end"]) if ga4["start"] <= d <= (ga4_last or "")]
        span = days_between(period["start"], period["end"])
        months.append({
            "id": month, "start": period["start"], "end": period["end"],
            "ga4Days": len(covered), "days": len(span),
            "visitors": len(ga4_users[month]["visitors"]) if covered else None,
            "checkoutVisitors": len(ga4_users[month]["checkout"]) if covered else None,
            "rentalEvents": sum(ga4_daily[d]["rentalsCompleted"] for d in covered) if covered else None,
            "moveIns": sum(f["moveIns"] or 0 for f in period["facilities"]),
            "onlineMoveIns": online.get(month, 0),
        })
    return {
        "schema": SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "cutoff": cutoff,
        "timeZone": "America/New_York",
        "coverage": {"ga4": {"start": ga4["start"], "lastExportedDay": ga4_last}, "google": {"start": google_start}, "meta": {"through": meta["through"]}},
        "rule": {"typicalDays": TYPICAL_DAYS, "minTypical": FLAG_MIN_TYPICAL, "ratio": FLAG_RATIO},
        "series": [{"key": k, "label": l, "source": s} for k, l, s in SERIES],
        "days": rows,
        "months": months,
        "flags": flag_runs(rows),
        "portalAdSource": portal_ad_source(ga4, cutoff, ga4_last, excluded),
    }


def main(argv: list[str]) -> None:
    defaults = [PRIVATE / "ga4-events-source.json", PRIVATE / "google-report.json", PRIVATE / "meta-leads-source.json",
                PRIVATE / "ccstorage-sources-source.json", ROOT / "data" / "reporting.json", ROOT / "data" / "restricted" / "tracking.json"]
    paths = [Path(a) for a in argv[1:]] + defaults[len(argv) - 1:]
    out = build(*(read(p) for p in paths[:5]))
    paths[5].parent.mkdir(parents=True, exist_ok=True)
    paths[5].write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {paths[5]} days={len(out['days'])} flags={len(out['flags'])} ga4 last exported {out['coverage']['ga4']['lastExportedDay']}")


if __name__ == "__main__":
    main(sys.argv)
