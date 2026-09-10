"""Build monthly and directly queried YTD GA4 aggregates from a private API extract.

Usage: python scripts/build-analytics.py /private/path/ga-2026-source.json
The input must contain complete, paginated stream-filtered reports for each month,
plus direct YTD summary/channel/page/city reports and a YTD date report. This
converter does not authenticate or make network requests. Users are never summed
across months or dimension rows to create a headline metric.
"""
import calendar
import json
import math
import re
import sys
from datetime import date
from pathlib import Path
from urllib.parse import unquote

KINDS = ("summary", "channels", "pages", "cities")
SUMMARY_METRICS = (
    "totalUsers", "newUsers", "sessions", "engagedSessions", "screenPageViews", "keyEvents"
)


def parse_rows(data):
    rows = []
    dimensions = [header["name"] for header in data.get("dimensionHeaders") or []]
    metrics = [header["name"] for header in data.get("metricHeaders") or []]
    seen = set()
    for source in data.get("rows") or []:
        assert len(source["metricValues"]) == len(metrics), "Metric header mismatch"
        item = {name: float(value["value"]) for name, value in zip(metrics, source["metricValues"])}
        assert all(math.isfinite(value) and value >= 0 for value in item.values()), "Invalid metric"
        values = source.get("dimensionValues") or []
        assert len(values) == len(dimensions), "Dimension header mismatch"
        item.update({name: value["value"] for name, value in zip(dimensions, values)})
        identity = tuple(item[name] for name in dimensions)
        assert identity not in seen, "Duplicate dimension row or repeated pagination page"
        seen.add(identity)
        rows.append(item)
    assert len(rows) == data.get("rowCount", 0), "Incomplete report"
    pages = data.get("pageMetadata") or []
    assert pages and sum(page["rows"] for page in pages) == len(rows), "Pagination evidence missing"
    expected_offset = 0
    for page in pages:
        assert page["offset"] == expected_offset, "Non-contiguous report pagination"
        expected_offset += page["rows"]
    if "pagePath" in dimensions:
        # Preserve additive page views and engagement while omitting potentially
        # individual paths. Distinct users cannot be added across these rows.
        private, public = [], []
        for row in rows:
            decoded = unquote(unquote(row["pagePath"]))
            sensitive = re.search(r"@|\?|#|[a-f0-9]{32}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|^/(?:invoices|payments)/", decoded, re.I)
            (private if sensitive else public).append(row)
        data["privatePathRowsOmitted"] = len(private)
        data["privatePathViews"] = sum(row["screenPageViews"] for row in private)
        if private:
            public.append({
                "pagePath": "[Private paths omitted]",
                "screenPageViews": data["privatePathViews"],
                "userEngagementDuration": sum(row["userEngagementDuration"] for row in private),
                "totalUsers": None,
            })
        rows = public
    return rows


def report_notes(data):
    pages = data.get("pageMetadata") or []
    metadata = [page.get("metadata") or {} for page in pages]
    notes = {
        "thresholding": any(item.get("subjectToThresholding", False) for item in metadata),
        "otherRow": any(item.get("dataLossFromOtherRow", False) for item in metadata),
        "sampled": any(item.get("samplingMetadatas") for item in metadata),
        "sampling": [sample for item in metadata for sample in item.get("samplingMetadatas", [])],
        "rowCount": data.get("rowCount", 0),
        "retrievedRows": sum(page["rows"] for page in pages),
        "pagesRetrieved": len(pages),
        "paginationComplete": True,
    }
    if "privatePathRowsOmitted" in data:
        notes["privatePathRowsOmitted"] = data["privatePathRowsOmitted"]
        notes["privatePathViews"] = data["privatePathViews"]
        notes["privatePathNote"] = "Potentially individual page paths are combined into one omitted-path bucket. Its views and engagement are additive; distinct users are not reported."
    return notes


def main():
    if len(sys.argv) not in (2, 3):
        raise SystemExit(__doc__)
    raw = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    requested_start, through = raw["requestedStart"], raw["through"]
    assert requested_start == "2026-01-01" and through.startswith("2026-"), "Expected a 2026 extract"
    end_date = date.fromisoformat(through)
    assert raw["stream"]["measurementId"] == "G-TCSG6BY1KK", "Unexpected stream"
    assert raw["property"]["id"] == "515113758", "Unexpected property"
    reports = {}
    for report in raw["reports"]:
        key = (report["period"], report["kind"])
        assert key not in reports, "Duplicate report"
        reports[key] = report
    expected_keys = {f"2026-{month:02d}" for month in range(1, end_date.month + 1)} | {"2026-ytd"}
    assert set(reports) == {(key, kind) for key in expected_keys for kind in KINDS} | {("2026-ytd", "daily")}, "Missing or unexpected period report"
    daily_report = reports[("2026-ytd", "daily")]
    assert daily_report["start"] == requested_start and daily_report["end"] == through
    daily_rows = parse_rows(daily_report["data"])
    active_dates = sorted(
        date.fromisoformat(row["date"]).isoformat()
        for row in daily_rows if any(row.get(metric, 0) > 0 for metric in SUMMARY_METRICS)
    )
    assert all(requested_start <= day <= through for day in active_dates), "Date outside requested range"
    daily_flags = report_notes(daily_report["data"])
    first_observed = active_dates[0] if active_dates else None
    last_observed = active_dates[-1] if active_dates else None
    out = {
        "schema": "storage-signal.analytics.v1",
        "refreshed": raw["extractedAt"][:10],
        "extractedAt": raw["extractedAt"],
        "through": through,
        "measurementId": raw["stream"]["measurementId"],
        "site": raw["stream"]["url"],
        "timeZone": raw["property"]["timeZone"],
        "coverage": {
            "requestedStart": requested_start,
            "through": through,
            "earliestObservedDate": first_observed,
            "lastObservedDate": last_observed,
            "propertyCreatedAt": raw["property"].get("createTime"),
            "streamCreatedAt": raw["stream"].get("createTime"),
            "note": "Every elapsed 2026 month was queried for this web stream. No recorded data does not prove zero website traffic. The first observed activity date does not prove complete instrumentation on subsequent days. YTD covers January 1 through the stated cutoff, not future 2026 dates.",
            "freshnessNote": "Latest days are provisional: GA4 processing commonly takes 24–48 hours, and source totals can change after this snapshot.",
            "dailyActivityQuery": {
                "start": requested_start,
                "end": through,
                "daysWithRecordedActivity": len(active_dates),
                "notes": daily_flags,
            },
        },
        "periods": {},
    }
    for key in sorted(expected_keys):
        first_report = reports[(key, "summary")]
        start, end = first_report["start"], first_report["end"]
        period_end = date.fromisoformat(end)
        if key == "2026-ytd":
            assert start == requested_start and end == through, "Incorrect YTD date range"
        else:
            month = int(key[-2:])
            assert start == f"2026-{month:02d}-01", "Incorrect month start"
            assert end == min(date(2026, month, calendar.monthrange(2026, month)[1]), end_date).isoformat(), "Incorrect month end"
        partial = period_end.day != calendar.monthrange(period_end.year, period_end.month)[1]
        label = "2026 year to date" if key == "2026-ytd" else calendar.month_name[int(key[-2:])]
        if key != "2026-ytd" and partial:
            label += f" 1–{period_end.day}"
        period = {"id": key, "label": label, "start": start, "end": end, "partial": partial, "notes": {}}
        for kind in KINDS:
            report = reports[(key, kind)]
            assert report["start"] == start and report["end"] == end, "Mismatched report dates"
            rows = parse_rows(report["data"])
            period["notes"][kind] = report_notes(report["data"])
            if kind == "summary":
                assert len(rows) <= 1, "Summary must be queried without dimensions"
                period[kind] = rows[0] if rows and any(rows[0].get(metric, 0) > 0 for metric in SUMMARY_METRICS) else None
            else:
                period[kind] = sorted(rows, key=lambda row: row.get("screenPageViews" if kind == "pages" else "sessions", 0), reverse=True)
        days = [day for day in active_dates if start <= day <= end]
        has_recorded_data = period["summary"] is not None
        assert has_recorded_data == bool(days), "Summary and daily activity disagree"
        period["coverage"] = {
            "status": "recorded" if has_recorded_data else "no-recorded-data",
            "firstObservedDate": days[0] if days else None,
            "lastObservedDate": days[-1] if days else None,
            "daysWithRecordedActivity": len(days),
            "queriedDays": (date.fromisoformat(end) - date.fromisoformat(start)).days + 1,
            "note": (
                "GA4 returned recorded activity in this queried period; collection completeness is not independently verified."
                if has_recorded_data else
                "GA4 returned no recorded activity for this web stream in this queried period. This does not prove zero website traffic."
            ),
        }
        if days and days[0] > start:
            period["coverage"]["note"] += f" First recorded activity in this period is {days[0]}; earlier queried days have no recorded activity."
        if has_recorded_data:
            summary = period["summary"]
            assert set(summary) == set(SUMMARY_METRICS), "Unexpected summary fields"
            assert summary["engagedSessions"] <= summary["sessions"], "Engaged sessions exceed sessions"
            page_views = sum(row["screenPageViews"] for row in period["pages"])
            period["notes"]["pages"]["pageViewDifferenceFromSummary"] = page_views - summary["screenPageViews"]
            exact = not any(period["notes"][kind][flag] for kind in ("summary", "pages") for flag in ("sampled", "thresholding", "otherRow"))
            if exact:
                assert page_views == summary["screenPageViews"], "Page views do not reconcile"
        else:
            assert all(not period[kind] for kind in KINDS if kind != "summary"), "Breakdown data without a summary"
        out["periods"][key] = period
        print(key, json.dumps(period["summary"]), period["coverage"]["status"])
    # This merely reconciles additive page views. Users remain the direct API
    # result even when the monthly user sum differs from the YTD distinct total.
    monthly_views = sum((period["summary"] or {}).get("screenPageViews", 0) for key, period in out["periods"].items() if key != "2026-ytd")
    ytd_summary = out["periods"]["2026-ytd"]["summary"] or {}
    out["coverage"]["monthlyPageViewsMinusYtd"] = monthly_views - ytd_summary.get("screenPageViews", 0)
    output = Path(sys.argv[2]) if len(sys.argv) == 3 else Path(__file__).resolve().parents[1] / "data" / "analytics.json"
    output.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("Coverage", json.dumps(out["coverage"]))


if __name__ == "__main__":
    main()
