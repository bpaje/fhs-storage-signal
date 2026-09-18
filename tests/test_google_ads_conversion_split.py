from __future__ import annotations

import copy
import importlib.util
import json
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def load_script(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


ads_builder = load_script("build_google_ads", ROOT / "scripts" / "build-google-ads.py")
reporting_builder = load_script("build_reporting", ROOT / "scripts" / "build-reporting.py")


def report(rows, dated=True):
    return {
        "query": {
            "customer_id": "123",
            "conditions": ["segments.date BETWEEN '2026-01-01' AND '2026-09-17'"] if dated else [],
            "limit": 10000,
        },
        "rows": rows,
    }


def metrics(month, conversions, campaign=False):
    row = {
        "segments.month": month + "-01",
        "metrics.cost_micros": 1_000_000,
        "metrics.impressions": 100,
        "metrics.clicks": 10,
        "metrics.conversions": conversions,
    }
    if campaign:
        row.update({"campaign.id": "7", "campaign.name": "[FHS] Test Search", "campaign.advertising_channel_type": "SEARCH"})
    return row


def action(month, action_id, name, category, conversions, campaign=False):
    row = {
        "segments.month": month + "-01",
        "segments.conversion_action": f"customers/123/conversionActions/{action_id}",
        "segments.conversion_action_name": name,
        "segments.conversion_action_category": category,
        "metrics.conversions": conversions,
        "metrics.all_conversions": conversions,
    }
    if campaign:
        row["campaign.id"] = "7"
    return row


def source_with_split():
    actions = [
        action("2026-08", "1", "GA4 generate_lead", "SUBMIT_LEAD_FORM", 2),
        action("2026-08", "2", "GA4 contact", "CONTACT", 1),
        action("2026-08", "3", "GA4 begin_checkout", "BEGIN_CHECKOUT", 3),
        action("2026-09", "4", "Calls from ads", "PHONE_CALL_LEAD", 1.5),
        action("2026-09", "5", "Store visits", "STORE_VISIT", .5),
        action("2026-09", "6", "Rental completed", "PURCHASE", 1),
        action("2026-09", "7", "Unmapped primary", "DEFAULT", 1),
    ]
    campaign_actions = [{**row, "campaign.id": "7"} for row in actions]
    definitions = [{
        "conversion_action.id": str(index), "conversion_action.name": row["segments.conversion_action_name"],
        "conversion_action.category": row["segments.conversion_action_category"], "conversion_action.type": "WEBPAGE",
        "conversion_action.status": "ENABLED", "conversion_action.primary_for_goal": True,
        "conversion_action.include_in_conversions_metric": True,
    } for index, row in enumerate(actions, 1)]
    return {
        "schema": "storage-signal.google-ads-source.v1",
        "extractedAt": "2026-09-18T12:00:00Z",
        "start": "2026-01-01",
        "through": "2026-09-17",
        "account": {"customer_client.id": "123", "customer_client.currency_code": "USD", "customer_client.time_zone": "America/New_York"},
        "pagination": {"limit": 10000},
        "reports": {
            "account": report([metrics("2026-08", 6), metrics("2026-09", 4)]),
            "accountYtd": report([{"metrics.cost_micros": 2_000_000, "metrics.impressions": 200, "metrics.clicks": 20, "metrics.conversions": 10}]),
            "campaigns": report([metrics("2026-08", 6, True), metrics("2026-09", 4, True)]),
            "groups": report([
                {**metrics("2026-08", 6), "campaign.id": "7", "ad_group.id": "70", "ad_group.name": "Test group"},
                {**metrics("2026-09", 4), "campaign.id": "7", "ad_group.id": "70", "ad_group.name": "Test group"},
            ]),
            "geography": report([]),
            "geonames": report([], dated=False),
            "conversionsByAction": report(actions),
            "campaignConversionsByAction": report(campaign_actions),
            "conversionActions": report(definitions, dated=False),
        },
    }


def test_grouping_ytd_campaigns_and_reconciliation_mutation():
    source = source_with_split()
    built = ads_builder.build(source, require_conversion_split=True)
    august = next(row for row in built["accountTotals"] if row["month"] == "2026-08")
    september = next(row for row in built["accountTotals"] if row["month"] == "2026-09")
    ytd = next(row for row in built["accountTotals"] if row["month"] == "2026-ytd")
    assert august["conversionsByGroup"] == {
        "leads_and_calls": 2, "phone_clicks": 1, "button_clicks": 3,
        "store_visits": 0, "rentals": 0, "other": 0,
    }
    assert september["conversionsByGroup"]["leads_and_calls"] == 1.5
    assert ytd["conversionsByGroup"] == {
        "leads_and_calls": 3.5, "phone_clicks": 1, "button_clicks": 3,
        "store_visits": .5, "rentals": 1, "other": 1,
    }
    assert sum(ytd["conversionsByGroup"].values()) == ytd["conversions"]
    campaign_ytd = next(row for row in built["campaigns"] if row["month"] == "2026-ytd")
    assert campaign_ytd["conversionsByGroup"] == ytd["conversionsByGroup"]
    assert {action["id"] for action in ytd["conversionsByAction"]} == {str(i) for i in range(1, 8)}

    mutant = copy.deepcopy(source)
    mutant["reports"]["conversionsByAction"]["rows"][0]["metrics.conversions"] += 1
    with pytest.raises(AssertionError, match="conversion-action reconciliation"):
        ads_builder.build(mutant, require_conversion_split=True)


def test_old_source_fallback_and_required_mode():
    source = source_with_split()
    for name in ads_builder.CONVERSION_SPLIT_REPORTS:
        del source["reports"][name]
    built = ads_builder.build(source)
    assert all("conversionsByGroup" not in row for row in built["accountTotals"])
    assert all("conversionsByAction" not in row for row in built["campaigns"])
    with pytest.raises(AssertionError, match="source predates conversion-action reports"):
        ads_builder.build(source, require_conversion_split=True)


def test_overview_build_uses_month_action_rows_and_old_source_fallback():
    cc = {"companies": [], "financial": [], "endOccupancy": [], "moves": [], "daily": [], "extractedAt": "2026-09-18T12:00:00Z"}
    google = []
    for month, end_day, conversions in [(8, 31, 6), (9, 17, 4)]:
        for day in range(1, end_day + 1):
            google.append({
                "segments.date": f"2026-{month:02d}-{day:02d}", "metrics.cost_micros": 1_000_000 if day == 1 else 0,
                "metrics.impressions": 100 if day == 1 else 0, "metrics.clicks": 10 if day == 1 else 0,
                "metrics.conversions": conversions if day == 1 else 0,
            })
    meta = {"timezone": "America/New_York", "refreshed": "2026-09-18", "reports": []}
    for start, end in [("2026-08-01", "2026-08-31"), ("2026-09-01", "2026-09-17")]:
        meta["reports"].append({"kind": "account", "start": start, "end": end, "rows": [{
            "date_start": start, "date_stop": end, "spend": "1", "impressions": "1", "clicks": "1",
            "inline_link_clicks": "1", "reach": "1", "actions": [],
        }]})

    built = reporting_builder.build(cc, google, meta, "2026-09-18", source_with_split())
    assert built["periods"][0]["google"]["conversionsByGroup"]["button_clicks"] == 3
    assert built["periods"][1]["google"]["conversionsByGroup"]["rentals"] == 1
    old = reporting_builder.build(cc, google, meta, "2026-09-18")
    assert all("conversionsByGroup" not in period["google"] for period in old["periods"])


def test_validate_data_accepts_and_rejects_conversion_group_sums():
    data_dir = ROOT / "tests" / f"conversion-validation-{uuid.uuid4().hex}"
    data_dir.mkdir()
    names = ("reporting.json", "google-ads.json", "analytics.json", "meta.json")
    try:
        for name in names:
            shutil.copy2(ROOT / "data" / name, data_dir / name)
        ads = json.loads((data_dir / "google-ads.json").read_text(encoding="utf-8"))
        overview = json.loads((data_dir / "reporting.json").read_text(encoding="utf-8"))
        def groups(total):
            return {"leads_and_calls": total, "phone_clicks": 0, "button_clicks": 0, "store_visits": 0, "rentals": 0, "other": 0}
        for row in ads["accountTotals"]:
            row["conversionsByGroup"] = groups(row["conversions"])
        for period in overview["periods"]:
            period["google"]["conversionsByGroup"] = groups(period["google"]["conversions"])
        (data_dir / "google-ads.json").write_text(json.dumps(ads), encoding="utf-8")
        (data_dir / "reporting.json").write_text(json.dumps(overview), encoding="utf-8")
        command = ["py", "-3.14", str(ROOT / "scripts" / "validate-data.py"), "--data-dir", str(data_dir)]
        valid = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
        assert valid.returncode == 0, valid.stderr

        overview["periods"][0]["google"]["conversionsByGroup"]["leads_and_calls"] += 1
        (data_dir / "reporting.json").write_text(json.dumps(overview), encoding="utf-8")
        invalid = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
        assert invalid.returncode != 0
        assert "conversionsByGroup" in invalid.stderr
    finally:
        for name in names:
            (data_dir / name).unlink(missing_ok=True)
        data_dir.rmdir()
