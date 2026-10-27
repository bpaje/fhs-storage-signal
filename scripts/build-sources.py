#!/usr/bin/env python3
"""Build the private "Source of rentals" evidence file (docs/ATTRIBUTION_PLAN.md, approved 2026-10-27).

Each non-void move-in counts once, in this order of precedence:
  confirmed  an exact email/phone match to a Meta lead that came before the move-in (existing lead matching)
  disagree   confirmed, but the campaign credited in CCStorage maps to a different Meta campaign (no winner is picked)
  credited   a campaign credited on the lease, or the campaign link on the online checkout that became the lease
  notRecorded  no evidence in the tiers above (always written; its online sub-count is the channel-known part)

Nothing is modeled or inferred from names. A campaign is tied to spend only through data/sources-mapping.json.
Output holds counts, facility ids and campaign slugs only. It goes to data/restricted/ (git-ignored, private host).

Usage: py -3.14 scripts/build-sources.py [source.json] [reporting.json] [leads-index.json] [mapping.json] [meta.json] [google-ads.json] [out.json]
"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = "storage-signal.sources.v1"
MAPPING_SCHEMA = "storage-signal.sources-mapping.v1"
MAX_SKEW_HOURS = 24
SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
DIGITS = re.compile(r"^\d{1,20}$")
FIELDS = ["company_id", "lease_id", "customer_id", "move_in_date", "credited_slug", "online", "online_slug", "online_converted"]
COUNT_KEYS = ["moveIns", "confirmed", "disagree", "creditedLease", "creditedOnline", "notRecorded", "notRecordedOnline"]


class SourcesError(SystemExit):
    pass


def fail(message: str) -> None:
    raise SourcesError(f"build-sources: {message}")


@lru_cache(maxsize=1)
def journeys_module():
    spec = importlib.util.spec_from_file_location("build_journeys", ROOT / "scripts" / "build-journeys.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def short_id(namespace: str, value: Any) -> str:
    return journeys_module().short_id(namespace, value)


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_mapping(raw: dict[str, Any] | None) -> dict[str, dict[str, list[str]]]:
    if raw is None:
        return {}
    if raw.get("schema") != MAPPING_SCHEMA:
        fail("sources-mapping.json has the wrong schema")
    mapping: dict[str, dict[str, list[str]]] = {}
    for entry in raw.get("campaigns", []):
        slug = entry.get("slug")
        if not isinstance(slug, str) or not SLUG.match(slug):
            fail(f"mapping slug {slug!r} is not a valid campaign slug")
        if slug in mapping:
            fail(f"mapping slug {slug!r} appears twice")
        ids: dict[str, list[str]] = {}
        for platform in ("meta", "google"):
            values = [str(v) for v in entry.get(platform, [])]
            if any(not DIGITS.match(v) for v in values):
                fail(f"mapping {slug!r} has a non-numeric {platform} campaign id")
            ids[platform] = values
        mapping[slug] = ids
    return mapping


def confirmed_leads(leads_index: dict[str, Any]) -> list[dict[str, Any]]:
    """Confirmed matches whose lead provably came before the move-in lease: moved in after the lead, or the
    same-day lead was created before the lease was signed. 'Already a tenant' is never counted."""
    out = []
    for lead in leads_index.get("leads", []):
        match = lead.get("match", {})
        if match.get("status") != "confirmed":
            continue
        for item in match.get("matches", []):
            timing = item.get("timing")
            move_in = item.get("move_in_date")
            eligible = timing == "moved in after lead"
            if not eligible and move_in and move_in == lead.get("created_date") and item.get("lease_signed") and lead.get("created_time"):
                eligible = parse_time(lead["created_time"]) < parse_time(item["lease_signed"])
            if eligible and move_in:
                out.append({"customer_id": item["customer_id"], "move_in_date": move_in, "campaign_key": lead["campaign"]["key"]})
    return out


def classify(rows: list[dict[str, Any]], confirmed: list[dict[str, Any]], mapping: dict[str, dict[str, list[str]]]) -> list[dict[str, Any]]:
    """Return one tier per row. Each confirmed lead can confirm only one move-in."""
    meta_keys = {slug: {short_id("fhs-campaign", cid) for cid in ids["meta"]} for slug, ids in mapping.items()}
    pending = defaultdict(list)
    for lead in confirmed:
        pending[(lead["customer_id"], lead["move_in_date"])].append(lead["campaign_key"])
    result = []
    for row in rows:
        credited = row["credited_slug"]
        online_slug = row["online_slug"]
        tier = {"tier": "notRecorded", "online": bool(row["online"]), "slug": None}
        keys = pending.get((row["customer_id"], row["move_in_date"]))
        slug = credited or online_slug
        if keys:
            lead_key = keys.pop(0)
            mapped = slug in meta_keys and bool(meta_keys[slug])
            tier = {"tier": "disagree" if mapped and lead_key not in meta_keys[slug] else "confirmed", "online": bool(row["online"]), "slug": slug}
        elif credited:
            tier = {"tier": "creditedLease", "online": bool(row["online"]), "slug": credited}
        elif online_slug:
            tier = {"tier": "creditedOnline", "online": bool(row["online"]), "slug": online_slug}
        result.append(tier)
    return result


def blank() -> dict[str, Any]:
    return {**{key: 0 for key in COUNT_KEYS}, "creditedBySlug": {}}


def add(target: dict[str, Any], tier: dict[str, Any]) -> None:
    target["moveIns"] += 1
    target[tier["tier"]] += 1
    if tier["tier"] == "notRecorded" and tier["online"]:
        target["notRecordedOnline"] += 1
    if tier["tier"] in ("creditedLease", "creditedOnline"):
        target["creditedBySlug"][tier["slug"]] = target["creditedBySlug"].get(tier["slug"], 0) + 1


def merge(target: dict[str, Any], source: dict[str, Any]) -> None:
    for key in COUNT_KEYS:
        target[key] += source[key]
    for slug, count in source["creditedBySlug"].items():
        target["creditedBySlug"][slug] = target["creditedBySlug"].get(slug, 0) + count


def spend_for(period_id: str, ids: dict[str, list[str]], meta: dict[str, Any], google: dict[str, Any]) -> float | None:
    total, found = 0.0, False
    meta_period = (meta.get("periods") or {}).get(period_id) or {}
    for campaign in meta_period.get("campaigns", []):
        if str(campaign.get("campaignId")) in ids["meta"]:
            total += float(campaign.get("spend") or 0)
            found = True
    for campaign in google.get("campaigns", []):
        if campaign.get("month") == period_id and str(campaign.get("id")) in ids["google"]:
            total += float(campaign.get("costMicros") or 0) / 1_000_000
            found = True
    return round(total, 2) if found else None


def build(source: dict[str, Any], reporting: dict[str, Any], leads_index: dict[str, Any], mapping: dict[str, dict[str, list[str]]],
          meta: dict[str, Any], google: dict[str, Any]) -> dict[str, Any]:
    periods = reporting["periods"]
    if source.get("fields") != FIELDS:
        fail("source extract has unexpected fields")
    cutoff = periods[-1]["end"]
    if source.get("cutoff") != cutoff:
        fail(f"source cutoff {source.get('cutoff')} differs from reporting end {cutoff}")
    skew = abs((parse_time(source["extractedAt"]) - parse_time(reporting["ccExtractedAt"])).total_seconds()) / 3600
    if skew > MAX_SKEW_HOURS:
        fail(f"source extraction is {skew:.1f} h from the reporting extraction (limit {MAX_SKEW_HOURS} h); re-extract together")
    if leads_index.get("extractedAt") != reporting["ccExtractedAt"]:
        fail("leads index was built from a different extraction than reporting.json")

    rows = source["rows"]
    for row in rows:
        for key in ("credited_slug", "online_slug"):
            if row[key] is not None and not SLUG.match(str(row[key])):
                fail(f"campaign slug {row[key]!r} is not a valid slug")
        if not (row["move_in_date"] or "")[:7]:
            fail("row without a move-in date")
    tiers = classify(rows, confirmed_leads(leads_index), mapping)

    cells: dict[tuple[str, str], dict[str, Any]] = defaultdict(blank)
    period_of = {p["id"]: p for p in periods}
    for row, tier in zip(rows, tiers):
        month = row["move_in_date"][:7]
        if month not in period_of:
            fail(f"move-in {row['move_in_date']} falls outside the reporting periods")
        period = period_of[month]
        if not (period["start"] <= row["move_in_date"] <= period["end"]):
            fail(f"move-in {row['move_in_date']} falls outside {month} reporting dates")
        add(cells[(month, str(row["company_id"]))], tier)

    out_periods = []
    for period in periods:
        facilities, portfolio = {}, blank()
        ids = {str(f["id"]) for f in period["facilities"]}
        for facility in period["facilities"]:
            cell = cells.get((period["id"], str(facility["id"])), blank())
            expected = facility.get("moveIns")
            if expected is not None and cell["moveIns"] != expected:
                fail(f"{period['id']} facility {facility['id']}: {cell['moveIns']} move-ins in the extract vs {expected} in reporting.json")
            if cell["moveIns"]:
                facilities[str(facility["id"])] = cell
            merge(portfolio, cell)
        stray = [key for key in cells if key[0] == period["id"] and key[1] not in ids]
        if stray:
            fail(f"{period['id']}: move-ins for facilities missing from reporting.json: {sorted(k[1] for k in stray)}")
        cost = []
        for slug, slug_ids in sorted(mapping.items()):
            rentals = portfolio["creditedBySlug"].get(slug, 0)
            spend = spend_for(period["id"], slug_ids, meta, google)
            if rentals and spend is not None:
                cost.append({"slug": slug, "creditedRentals": rentals, "spend": spend, "costPerRentalAtLeast": round(spend / rentals, 2)})
        out_periods.append({"id": period["id"], "start": period["start"], "end": period["end"], "portfolio": portfolio, "facilities": facilities, "cost": cost})

    for p in out_periods:
        for cell in [p["portfolio"], *p["facilities"].values()]:
            parts = cell["confirmed"] + cell["disagree"] + cell["creditedLease"] + cell["creditedOnline"] + cell["notRecorded"]
            if parts != cell["moveIns"] or cell["notRecordedOnline"] > cell["notRecorded"]:
                fail(f"{p['id']}: tier counts do not reconcile to move-ins")
    return {
        "schema": SCHEMA,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "extractedAt": source["extractedAt"],
        "reportingExtractedAt": reporting["ccExtractedAt"],
        "cutoff": cutoff,
        "mappedCampaigns": sorted(mapping),
        "periods": out_periods,
    }


def main() -> None:
    args = sys.argv[1:]
    paths = [Path(a) for a in args] + [None] * (7 - len(args))
    source_path = paths[0] or ROOT / "private-scripts" / "ccstorage-sources-source.json"
    reporting_path = paths[1] or ROOT / "data" / "reporting.json"
    leads_path = paths[2] or ROOT / "data" / "restricted" / "tenants-leads-index.json"
    mapping_path = paths[3] or ROOT / "data" / "sources-mapping.json"
    meta_path = paths[4] or ROOT / "data" / "meta.json"
    google_path = paths[5] or ROOT / "data" / "google-ads.json"
    out_path = paths[6] or ROOT / "data" / "restricted" / "tenants-sources.json"
    mapping = read_mapping(load_json(mapping_path) if mapping_path.exists() else None)
    result = build(load_json(source_path), load_json(reporting_path), load_json(leads_path), mapping, load_json(meta_path), load_json(google_path))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    total = Counter()
    for period in result["periods"]:
        for key in COUNT_KEYS:
            total[key] += period["portfolio"][key]
    print("wrote", out_path, dict(total))


if __name__ == "__main__":
    main()
