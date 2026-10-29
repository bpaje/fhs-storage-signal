#!/usr/bin/env python3
"""Build the private Google Ads watch-list and keyword file (data/restricted/ads-watch.json).

Daily campaign and keyword rows for the last 90 days (private-scripts/google-ads-watch-source.json, written by
private-scripts/fetch-google-ads-watch.ps1), so the Watch list and Keywords tabs can total any window in the browser.
Conversions keep the dashboard's grouping by conversion-action category (scripts/build-google-ads.py): a lead is
leads_and_calls + phone_clicks there; checkout-button clicks and store visits stay separate and are never leads.

Impression share is carried as impression counts, not percentages, so a window's share is a ratio of sums:
eligibleImpressions = impressions / search_impression_share, and the lost-to-budget and lost-to-rank counts are
eligibleImpressions times those shares. A day with no impressions has no eligible count (null), never zero.

Usage: py -3.14 scripts/build-ads-watch.py [source.json] [out.json]
"""
from __future__ import annotations

import importlib.util
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / "private-scripts"
SOURCE_SCHEMA = "storage-signal.google-ads-watch-source.v1"
SCHEMA = "storage-signal.ads-watch.v1"
GROUP_LABELS = {
    "leads_and_calls": "Ad calls of 60 seconds or more and website form leads",
    "phone_clicks": "Taps on the website phone number",
    "button_clicks": "Checkout-button clicks (also fire on Pay your bill); not leads",
    "store_visits": "Google's modelled store visits; not leads",
    "rentals": "Rentals (Google is never told about rentals, so always 0)",
    "other": "Other conversion actions",
}


class WatchError(SystemExit):
    pass


def conversion_groups() -> tuple[dict[str, str], tuple[str, ...]]:
    # One definition of what counts as a lead: reuse build-google-ads.py rather than copy it.
    spec = importlib.util.spec_from_file_location("build_google_ads", ROOT / "scripts" / "build-google-ads.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.CONVERSION_GROUPS, module.CONVERSION_GROUP_ORDER


def number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def share(value: Any) -> float | None:
    return None if value is None else number(value)


def money(micros: Any) -> float:
    return round(number(micros) / 1_000_000, 2)


def eligible_counts(impressions: float, is_share: float | None, lost_budget: float | None, lost_rank: float | None) -> list[float | None]:
    if not impressions or not is_share:
        return [None, None, None]
    eligible = impressions / is_share
    return [round(eligible, 1), round(eligible * (lost_budget or 0), 1), round(eligible * (lost_rank or 0), 1)]


def quality(value: Any) -> str | None:
    return value if value in ("BELOW_AVERAGE", "AVERAGE", "ABOVE_AVERAGE") else None


def build(source: dict[str, Any]) -> dict[str, Any]:
    if source.get("schema") != SOURCE_SCHEMA:
        raise WatchError(f"unexpected source schema {source.get('schema')!r}")
    groups, order = conversion_groups()
    reports = source["reports"]

    campaigns = sorted(({
        "id": str(row["campaign.id"]),
        "name": row["campaign.name"],
        "status": row["campaign.status"],
        "channel": row.get("campaign.advertising_channel_type"),
        "bidding": row.get("campaign.bidding_strategy_type"),
        "budgetPerDay": money(row.get("campaign_budget.amount_micros")) if row.get("campaign_budget.amount_micros") is not None else None,
    } for row in reports["campaigns"]), key=lambda c: (c["status"] != "ENABLED", c["name"].lower()))
    campaign_ids = {c["id"] for c in campaigns}

    conv: dict[tuple[str, str], dict[str, float]] = defaultdict(lambda: dict.fromkeys(order, 0.0))
    for row in reports["campaignConversions"]:
        conv[(row["segments.date"], str(row["campaign.id"]))][groups.get(row["segments.conversion_action_category"], "other")] += number(row["metrics.conversions"])

    day_rows = []
    seen = set()
    for row in reports["campaignDays"]:
        key = (row["segments.date"], str(row["campaign.id"]))
        if key in seen:
            raise WatchError(f"duplicate campaign day {key}")
        seen.add(key)
        impressions = number(row.get("metrics.impressions"))
        day_rows.append([key[0], key[1], money(row.get("metrics.cost_micros")), int(impressions), int(number(row.get("metrics.clicks"))),
                         int(number(row.get("metrics.phone_calls"))),
                         *eligible_counts(impressions, share(row.get("metrics.search_impression_share")),
                                          share(row.get("metrics.search_budget_lost_impression_share")),
                                          share(row.get("metrics.search_rank_lost_impression_share"))),
                         *(round(conv.get(key, {}).get(g, 0.0), 2) for g in order)])
    # Conversions can arrive on a day with no delivery row (late calls); keep them rather than drop them.
    for key, values in conv.items():
        if key not in seen and key[1] in campaign_ids:
            day_rows.append([key[0], key[1], 0.0, 0, 0, 0, None, None, None, *(round(values[g], 2) for g in order)])
    day_rows.sort(key=lambda r: (r[0], r[1]))

    kconv: dict[tuple[str, str], dict[str, float]] = defaultdict(lambda: dict.fromkeys(order, 0.0))
    for row in reports["keywordConversions"]:
        kid = f"{row['ad_group.id']}~{row['ad_group_criterion.criterion_id']}"
        kconv[(row["segments.date"], kid)][groups.get(row["segments.conversion_action_category"], "other")] += number(row["metrics.conversions"])
    kdays = []
    active = set()
    for row in reports["keywordDays"]:
        kid = f"{row['ad_group.id']}~{row['ad_group_criterion.criterion_id']}"
        key = (row["segments.date"], kid)
        active.add(kid)
        kdays.append([key[0], kid, money(row.get("metrics.cost_micros")), int(number(row.get("metrics.impressions"))),
                      int(number(row.get("metrics.clicks"))), *(round(kconv.get(key, {}).get(g, 0.0), 2) for g in order)])
    kdays.sort(key=lambda r: (r[0], r[1]))

    status_of = {c["id"]: c["status"] for c in campaigns}
    keywords = []
    for row in reports["keywords"]:
        kid = f"{row['ad_group.id']}~{row['ad_group_criterion.criterion_id']}"
        cid = str(row["campaign.id"])
        live = row["ad_group_criterion.status"] == "ENABLED" and row.get("ad_group.status") == "ENABLED" and status_of.get(cid) == "ENABLED"
        if kid not in active and not live:
            continue  # paused keywords with no traffic in the window add nothing to either tab
        keywords.append({
            "id": kid, "campaignId": cid, "adGroupId": str(row["ad_group.id"]), "adGroup": row.get("ad_group.name"),
            "adGroupStatus": row.get("ad_group.status"), "text": row.get("ad_group_criterion.keyword.text"),
            "matchType": row.get("ad_group_criterion.keyword.match_type"), "status": row["ad_group_criterion.status"],
            "qualityScore": row.get("ad_group_criterion.quality_info.quality_score"),
            "expectedCtr": quality(row.get("ad_group_criterion.quality_info.search_predicted_ctr")),
            "adRelevance": quality(row.get("ad_group_criterion.quality_info.creative_quality_score")),
            "landingPage": quality(row.get("ad_group_criterion.quality_info.post_click_quality_score")),
        })
    known = {k["id"] for k in keywords}
    missing = active - known
    if missing:
        raise WatchError(f"{len(missing)} keywords have traffic but no keyword record, e.g. {sorted(missing)[0]}")
    keywords.sort(key=lambda k: (k["campaignId"], k["adGroup"] or "", k["text"] or ""))

    # Google's own shares for the preset windows ending at `through`; the tabs prefer these to rebuilt ones.
    window_shares = {}
    for days, rows in (reports.get("windowShares") or {}).items():
        window_shares[days] = {str(row["campaign.id"]): {
            "impressionShare": share(row.get("metrics.search_impression_share")),
            "lostBudget": share(row.get("metrics.search_budget_lost_impression_share")),
            "lostRank": share(row.get("metrics.search_rank_lost_impression_share")),
        } for row in rows}

    columns = ["date", "campaignId", "cost", "impressions", "clicks", "phoneCalls",
               "eligibleImpressions", "lostBudgetImpressions", "lostRankImpressions", *order]
    return {
        "schema": SCHEMA,
        "extractedAt": source["extractedAt"],
        "from": source["start"],
        "through": source["through"],
        "currency": "USD",
        "timeZone": "America/New_York",
        "groups": {g: GROUP_LABELS[g] for g in order},
        "campaigns": campaigns,
        "campaignDays": {"columns": columns, "rows": day_rows},
        "windowShares": window_shares,
        "keywords": keywords,
        "keywordDays": {"columns": ["date", "keywordId", "cost", "impressions", "clicks", *order], "rows": kdays},
    }


def main(argv: list[str]) -> None:
    source = Path(argv[1]) if len(argv) > 1 else PRIVATE / "google-ads-watch-source.json"
    out = Path(argv[2]) if len(argv) > 2 else ROOT / "data" / "restricted" / "ads-watch.json"
    try:
        data = build(json.loads(source.read_text(encoding="utf-8")))
    except FileNotFoundError as error:
        raise WatchError(f"missing input: {source}") from error
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {out} campaigns={len(data['campaigns'])} campaignDays={len(data['campaignDays']['rows'])} "
          f"keywords={len(data['keywords'])} keywordDays={len(data['keywordDays']['rows'])} {data['from']}..{data['through']}")


if __name__ == "__main__":
    main(sys.argv)
