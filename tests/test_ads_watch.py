import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_ads_watch", ROOT / "scripts" / "build-ads-watch.py")
watch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch)


def source():
    def campaign(cid, name, status, budget):
        return {"campaign.id": cid, "campaign.name": name, "campaign.status": status, "campaign.advertising_channel_type": "SEARCH",
                "campaign.bidding_strategy_type": "TARGET_SPEND", "campaign_budget.amount_micros": str(budget * 1_000_000)}

    def keyword(cid, ag, crit, text, status="ENABLED", ag_status="ENABLED", qs=4):
        return {"campaign.id": cid, "ad_group.id": ag, "ad_group.name": "Storage Units", "ad_group.status": ag_status,
                "ad_group_criterion.criterion_id": crit, "ad_group_criterion.keyword.text": text,
                "ad_group_criterion.keyword.match_type": "BROAD", "ad_group_criterion.status": status,
                "ad_group_criterion.quality_info.quality_score": qs,
                "ad_group_criterion.quality_info.search_predicted_ctr": "BELOW_AVERAGE",
                "ad_group_criterion.quality_info.creative_quality_score": "AVERAGE",
                "ad_group_criterion.quality_info.post_click_quality_score": "UNSPECIFIED"}

    return {
        "schema": "storage-signal.google-ads-watch-source.v1", "extractedAt": "2026-10-30T00:00:00Z",
        "start": "2026-10-20", "through": "2026-10-28",
        "reports": {
            "campaigns": [campaign("1", "[FHS] Alpha Search", "ENABLED", 10), campaign("2", "[FHS] Beta Search", "PAUSED", 5)],
            "campaignDays": [
                {"segments.date": "2026-10-22", "campaign.id": "1", "metrics.cost_micros": "12500000", "metrics.impressions": "40",
                 "metrics.clicks": "4", "metrics.phone_calls": "2", "metrics.search_impression_share": 0.5,
                 "metrics.search_budget_lost_impression_share": 0.25, "metrics.search_rank_lost_impression_share": 0.25},
                {"segments.date": "2026-10-23", "campaign.id": "1", "metrics.cost_micros": "0", "metrics.impressions": "0",
                 "metrics.clicks": "0", "metrics.search_impression_share": 0},
            ],
            "campaignConversions": [
                {"segments.date": "2026-10-22", "campaign.id": "1", "segments.conversion_action_category": "PHONE_CALL_LEAD", "metrics.conversions": 1},
                {"segments.date": "2026-10-22", "campaign.id": "1", "segments.conversion_action_category": "CONTACT", "metrics.conversions": 2},
                {"segments.date": "2026-10-22", "campaign.id": "1", "segments.conversion_action_category": "BEGIN_CHECKOUT", "metrics.conversions": 3},
                {"segments.date": "2026-10-24", "campaign.id": "1", "segments.conversion_action_category": "PHONE_CALL_LEAD", "metrics.conversions": 1},
            ],
            "keywords": [keyword("1", "10", "100", "storage units"), keyword("1", "10", "101", "old term", status="PAUSED"),
                         keyword("2", "20", "200", "paused campaign term")],
            "keywordDays": [{"segments.date": "2026-10-22", "ad_group.id": "10", "ad_group_criterion.criterion_id": "100",
                             "metrics.cost_micros": "12500000", "metrics.impressions": "40", "metrics.clicks": "4"}],
            "keywordConversions": [{"segments.date": "2026-10-22", "ad_group.id": "10", "ad_group_criterion.criterion_id": "100",
                                    "segments.conversion_action_category": "SUBMIT_LEAD_FORM", "metrics.conversions": 1}],
            "windowShares": {"7": [{"campaign.id": "1", "metrics.search_impression_share": 0.4,
                                    "metrics.search_budget_lost_impression_share": 0.35, "metrics.search_rank_lost_impression_share": 0.25}]},
        },
    }


def test_campaign_days_keep_groups_apart_and_shares_as_counts():
    out = watch.build(source())
    cols = out["campaignDays"]["columns"]
    row = dict(zip(cols, out["campaignDays"]["rows"][0]))
    assert row["cost"] == 12.5 and row["phoneCalls"] == 2
    assert (row["leads_and_calls"], row["phone_clicks"], row["button_clicks"]) == (1, 2, 3)
    assert (row["eligibleImpressions"], row["lostBudgetImpressions"], row["lostRankImpressions"]) == (80, 20, 20)
    zero = dict(zip(cols, out["campaignDays"]["rows"][1]))
    assert zero["eligibleImpressions"] is None  # no impressions: unknown, never zero


def test_late_conversion_without_delivery_row_is_kept():
    rows = [dict(zip(watch.build(source())["campaignDays"]["columns"], r)) for r in watch.build(source())["campaignDays"]["rows"]]
    late = [r for r in rows if r["date"] == "2026-10-24"]
    assert len(late) == 1 and late[0]["cost"] == 0 and late[0]["leads_and_calls"] == 1


def test_keywords_drop_paused_ones_without_traffic_and_map_quality():
    out = watch.build(source())
    ids = {k["id"] for k in out["keywords"]}
    assert ids == {"10~100"}
    kw = out["keywords"][0]
    assert (kw["qualityScore"], kw["expectedCtr"], kw["adRelevance"], kw["landingPage"]) == (4, "BELOW_AVERAGE", "AVERAGE", None)
    day = dict(zip(out["keywordDays"]["columns"], out["keywordDays"]["rows"][0]))
    assert day["keywordId"] == "10~100" and day["leads_and_calls"] == 1


def test_window_shares_and_budgets():
    out = watch.build(source())
    assert out["windowShares"]["7"]["1"] == {"impressionShare": 0.4, "lostBudget": 0.35, "lostRank": 0.25}
    assert out["campaigns"][0]["budgetPerDay"] == 10 and out["campaigns"][0]["status"] == "ENABLED"
    assert out["campaigns"][1]["status"] == "PAUSED"


def test_traffic_for_unknown_keyword_fails_loudly():
    src = source()
    src["reports"]["keywordDays"][0]["ad_group_criterion.criterion_id"] = "999"
    with pytest.raises(SystemExit):
        watch.build(src)


def test_output_has_no_extra_fields():
    out = watch.build(source())
    assert set(out) == {"schema", "extractedAt", "from", "through", "currency", "timeZone", "groups", "campaigns",
                        "campaignDays", "windowShares", "keywords", "keywordDays"}
    json.dumps(out)
