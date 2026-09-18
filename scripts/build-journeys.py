"""Build restricted Meta-lead and anonymous GA4 journey indexes.

Usage:
  py -3.14 scripts/build-journeys.py TENANTS CONTACT_HASHES META_LEADS GA4_EVENTS REPORTING META

All validation and privacy checks run before any output file is replaced.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import statistics
import sys
import tempfile
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "data" / "restricted"
LEADS_SCHEMA = "storage-signal.leads.v1"
VISITORS_SCHEMA = "storage-signal.visitors.v1"
KEY_EVENTS = (
    "generate_lead",
    "contact",
    "form_submit",
    "begin_checkout",
    "outbound_click",
    "ccstorage_rental_completed",
)
ELIGIBLE_PAYMENT_STATUSES = {
    "Complete",
    "Manually Entered",
    "Partially Refunded",
    "Refunded",
}
NAME_WITHHELD = "Name withheld"
TEXT_WITHHELD = "Withheld"
HASH_RE = re.compile(r"^[0-9a-f]{64}$", re.I)
LONG_DIGITS_RE = re.compile(r"\d{10,}")
# CCStorage record IDs are UUIDs; a UUID's 12-hex tail can be all digits by chance. Only an exact
# UUID is exempt from the phone-number digit-run check; everything else is still scanned.
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
CONTACT_RE = re.compile(r"@|https?://|www\.|m\.me|messenger", re.I)
IP_RE = re.compile(r"(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)")
FORBIDDEN_KEY_PARTS = ("email", "phone", "sha256", "inbox_url", "user_pseudo_id", "ip_address")


class BuildError(ValueError):
    """A contract or privacy failure that prevents every write."""


def normalize_email(value: Any) -> str | None:
    text = str(value or "").strip().lower()
    return text or None


def normalize_phone(value: Any) -> str | None:
    digits = "".join(character for character in str(value or "") if character.isdigit())
    return digits[-10:] if len(digits) >= 10 else None


def sha256_hex(value: str | None) -> str | None:
    return hashlib.sha256(value.encode("utf-8")).hexdigest() if value else None


def short_id(namespace: str, value: Any) -> str:
    digest = hashlib.sha256(f"{namespace}:{value}".encode("utf-8")).hexdigest()[:12]
    return "-".join((digest[:4], digest[4:8], digest[8:]))


def visitor_id(value: Any) -> str:
    # Grouped in fours so a digest can never form a 10+ digit run (the phone-number guard).
    # About 1 in 30 raw 12-hex digests would otherwise trip it and abort the whole build.
    digest = hashlib.sha256(f"fhs-visitor:{value}".encode("utf-8")).hexdigest()[:12]
    grouped = "-".join(digest[i:i + 4] for i in range(0, 12, 4))
    if LONG_DIGITS_RE.search(grouped):
        raise BuildError("visitor ID digest would violate the long-digit privacy guard")
    return grouped


def identifier(value: Any, field: str) -> str:
    if value is None or isinstance(value, bool) or not str(value).strip():
        raise BuildError(f"{field} is required")
    return str(value).strip()


def iso_day(value: Any, field: str) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError) as exc:
        raise BuildError(f"{field} must be an ISO date") from exc


def optional_day(value: Any, field: str) -> date | None:
    return None if value in (None, "") else iso_day(value, field)


def parse_timestamp(value: Any, field: str) -> datetime:
    text = str(value or "").strip()
    try:
        if re.fullmatch(r"\d+", text):
            return datetime.fromtimestamp(int(text) / 1_000_000, tz=timezone.utc)
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone.utc)
    except (OverflowError, TypeError, ValueError) as exc:
        raise BuildError(f"{field} must be an ISO timestamp or Unix microseconds") from exc


def timestamp_text(value: Any, field: str) -> str:
    return parse_timestamp(value, field).isoformat(timespec="seconds").replace("+00:00", "Z")


def rows(source: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = source.get(key)
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise BuildError(f"{key} must be a list of objects")
    return value


def clean_name(value: Any) -> str:
    """Keep exact parity with build-tenants.py's display-name rule."""
    text = " ".join(str(value or "").split())
    if not text or "@" in text or sum(character.isdigit() for character in text) >= 7:
        return NAME_WITHHELD
    return text


def safe_text(value: Any, fallback: str = TEXT_WITHHELD, maximum: int = 160) -> str:
    text = " ".join(str(value or "").split())[:maximum]
    if not text or CONTACT_RE.search(text) or LONG_DIGITS_RE.search(text) or IP_RE.search(text):
        return fallback
    return text


def safe_optional(value: Any, maximum: int = 160) -> str | None:
    text = " ".join(str(value or "").split())[:maximum]
    if not text:
        return None
    return None if CONTACT_RE.search(text) or LONG_DIGITS_RE.search(text) or IP_RE.search(text) else text


def normalized_name(value: Any) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).split())


def customer_name_variants(value: Any) -> set[str]:
    text = str(value or "")
    variants = {normalized_name(text)}
    if "," in text:
        last, remainder = text.split(",", 1)
        variants.add(normalized_name(f"{remainder} {last}"))
    return {item for item in variants if item}


def decimal_value(value: Any, field: str) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise BuildError(f"{field} must be decimal-compatible") from exc
    if not parsed.is_finite():
        raise BuildError(f"{field} must be finite")
    return parsed


def reporting_cutoff(reporting: dict[str, Any]) -> date:
    periods = reporting.get("periods")
    if not isinstance(periods, list) or not periods:
        raise BuildError("reporting.json has no periods")
    return max(iso_day(period.get("end"), "reporting period end") for period in periods)


def validate_snapshot_alignment(
    tenants: dict[str, Any], contacts: dict[str, Any], reporting: dict[str, Any], leads: dict[str, Any]
) -> date:
    extracted = tenants.get("extractedAt")
    expected = reporting.get("ccExtractedAt")
    contact_extracted = contacts.get("extractedAt")
    if not extracted or extracted != expected or contact_extracted != expected:
        raise BuildError(
            "extractedAt mismatch: "
            f"tenants={extracted!r} contacts={contact_extracted!r} reporting.ccExtractedAt={expected!r}"
        )
    cutoff = reporting_cutoff(reporting)
    if iso_day(leads.get("through"), "meta leads through") < cutoff:
        raise BuildError(f"meta-leads-source through must be on or after reporting cutoff {cutoff}")
    return cutoff


def hash_value(value: Any, field: str) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).lower()
    if not HASH_RE.fullmatch(text):
        raise BuildError(f"{field} must be a SHA-256 hex digest")
    return text


def tenant_maps(tenants: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    customer_map: dict[str, dict[str, Any]] = {}
    for customer in rows(tenants, "customers"):
        customer_id = identifier(customer.get("id"), "customer.id")
        if customer_id in customer_map:
            raise BuildError(f"duplicate customer {customer_id}")
        customer_map[customer_id] = customer
    leases_by_customer: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for lease in rows(tenants, "leases"):
        customer_id = identifier(lease.get("customer_id"), "lease.customer_id")
        if customer_id not in customer_map:
            raise BuildError(f"lease references unknown customer {customer_id}")
        if lease.get("void") is False:
            leases_by_customer[customer_id].append(lease)
    return customer_map, leases_by_customer


def contact_indexes(
    contacts: dict[str, Any], customer_map: dict[str, dict[str, Any]]
) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    emails: dict[str, set[str]] = defaultdict(set)
    phones: dict[str, set[str]] = defaultdict(set)
    for item in rows(contacts, "customers"):
        customer_id = identifier(item.get("customer_id"), "contact customer_id")
        if customer_id not in customer_map:
            raise BuildError(f"contact hash references unknown customer {customer_id}")
        email = hash_value(item.get("email_sha256"), "contact email hash")
        phone = hash_value(item.get("phone_sha256"), "contact phone hash")
        if email:
            emails[email].add(customer_id)
        if phone:
            phones[phone].add(customer_id)
    return emails, phones


def payment_summaries(tenants: dict[str, Any], cutoff: date) -> dict[str, dict[str, Any]]:
    summaries: dict[str, dict[str, Any]] = defaultdict(lambda: {"count": 0, "net": Decimal("0")})
    for payment in tenants.get("payments", []):
        if not isinstance(payment, dict) or payment.get("status") not in ELIGIBLE_PAYMENT_STATUSES:
            continue
        if iso_day(payment.get("effective_date"), "payment.effective_date") > cutoff:
            continue
        customer_id = identifier(payment.get("customer_id"), "payment.customer_id")
        summaries[customer_id]["count"] += 1
        summaries[customer_id]["net"] += decimal_value(payment.get("effective_amount"), "payment.effective_amount")
    return summaries


def signed_dates(tenants: dict[str, Any]) -> dict[str, str]:
    output: dict[str, str] = {}
    for item in tenants.get("leaseSigned", []):
        if not isinstance(item, dict) or not item.get("accepted_at"):
            continue
        lease_id = identifier(item.get("lease_id"), "leaseSigned.lease_id")
        value = timestamp_text(item.get("accepted_at"), "leaseSigned.accepted_at")
        if lease_id not in output or value < output[lease_id]:
            output[lease_id] = value
    return output


def lease_timing(
    customer_id: str,
    lead_day: date,
    leases_by_customer: dict[str, list[dict[str, Any]]],
    signed_by_lease: dict[str, str],
    payment_by_customer: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    leases = leases_by_customer.get(customer_id, [])
    active: list[tuple[date, dict[str, Any]]] = []
    future: list[tuple[date, dict[str, Any]]] = []
    for lease in leases:
        moved_in = optional_day(lease.get("move_in_date"), "lease.move_in_date")
        moved_out = optional_day(lease.get("move_out_date"), "lease.move_out_date")
        if not moved_in:
            continue
        if moved_in <= lead_day and (moved_out is None or moved_out >= lead_day):
            active.append((moved_in, lease))
        if moved_in >= lead_day:
            future.append((moved_in, lease))
    if active:
        moved_in, chosen = min(active, key=lambda item: item[0])
        timing = "already a tenant"
        days_to_move_in = None
    elif future:
        moved_in, chosen = min(future, key=lambda item: item[0])
        days_to_move_in = (moved_in - lead_day).days
        timing = "moved in after lead"
    else:
        moved_in, chosen, days_to_move_in, timing = None, None, None, "no move-in yet"
    payment = payment_by_customer.get(customer_id, {"count": 0, "net": Decimal("0")})
    return {
        "timing": timing,
        "days_to_move_in": days_to_move_in,
        "lease_signed": signed_by_lease.get(str(chosen.get("id"))) if chosen else None,
        "move_in_date": moved_in.isoformat() if moved_in else None,
        "payments": {"count": payment["count"], "net": format(payment["net"], ".2f")},
    }


def safe_answers(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    output: dict[str, str] = {}
    for raw_key, raw_value in value.items():
        key = "_".join(str(raw_key).strip().split())[:80]
        lowered = key.lower()
        if not key or any(part in lowered for part in ("email", "phone", "inbox", "url", "messenger")):
            continue
        answer = safe_optional(raw_value, 80)
        if answer:
            output[key] = answer
    return output


def raw_campaign_context(lead: dict[str, Any], form_ads: dict[str, Any]) -> dict[str, Any]:
    direct_id = str(lead.get("campaign_id") or "").strip()
    direct_name = str(lead.get("campaign_name") or "").strip()
    if direct_id or direct_name:
        return {
            "raw_id": direct_id or None,
            "name": safe_text(direct_name or "Unknown"),
            "source": "lead",
            "adset": safe_text(lead.get("adset_name") or "Unknown"),
            "ad": safe_text(lead.get("ad_name") or "Unknown"),
        }
    candidates = form_ads.get(str(lead.get("form_id") or ""), [])
    if not isinstance(candidates, list):
        candidates = []
    campaigns: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        campaign_id = str(candidate.get("campaign_id") or "").strip()
        campaign_name = str(candidate.get("campaign_name") or "").strip()
        key = campaign_id or campaign_name
        if key:
            campaigns[key] = candidate
    if len(campaigns) == 1:
        candidate = next(iter(campaigns.values()))
        adsets = {safe_text(item.get("adset_name") or "Unknown") for item in candidates if isinstance(item, dict)}
        ads = {safe_text(item.get("ad_name") or "Unknown") for item in candidates if isinstance(item, dict)}
        return {
            "raw_id": str(candidate.get("campaign_id") or "").strip() or None,
            "name": safe_text(candidate.get("campaign_name") or "Unknown"),
            "source": "formAds",
            "adset": next(iter(adsets)) if len(adsets) == 1 else "Multiple ad sets",
            "ad": next(iter(ads)) if len(ads) == 1 else "Multiple ads",
        }
    if campaigns:
        return {"raw_id": None, "name": "Multiple campaigns", "source": "formAds", "adset": "Multiple ad sets", "ad": "Multiple ads"}
    return {"raw_id": None, "name": "Unknown", "source": "unknown", "adset": "Unknown", "ad": "Unknown"}


def meta_spend(meta: dict[str, Any], campaign_id: str | None, months: set[str]) -> Decimal | None:
    if not campaign_id:
        return None
    periods = meta.get("periods")
    if not isinstance(periods, dict):
        raise BuildError("meta.json periods must be an object")
    total = Decimal("0")
    found = False
    for month in months:
        period = periods.get(month)
        if not isinstance(period, dict):
            continue
        for campaign in period.get("campaigns", []):
            raw_id = str(campaign.get("campaignId") or campaign.get("id") or "")
            if raw_id == campaign_id:
                total += decimal_value(campaign.get("spend", 0), "meta campaign spend")
                found = True
    return total if found else None


def meta_lead_count(meta: dict[str, Any], month: str) -> Any:
    period = meta.get("periods", {}).get(month)
    return period.get("account", {}).get("leads") if isinstance(period, dict) else None


def build_leads(
    tenants: dict[str, Any], contacts: dict[str, Any], leads_source: dict[str, Any], reporting: dict[str, Any], meta: dict[str, Any]
) -> dict[str, Any]:
    cutoff = validate_snapshot_alignment(tenants, contacts, reporting, leads_source)
    customer_map, leases_by_customer = tenant_maps(tenants)
    email_index, phone_index = contact_indexes(contacts, customer_map)
    signed_by_lease = signed_dates(tenants)
    payment_by_customer = payment_summaries(tenants, cutoff)
    form_names = {str(item.get("id")): safe_text(item.get("name") or "Unknown") for item in leads_source.get("forms", []) if isinstance(item, dict)}
    form_ads = leads_source.get("formAds") if isinstance(leads_source.get("formAds"), dict) else {}
    built: list[dict[str, Any]] = []
    later_count = 0
    raw_campaign_ids: dict[str, str | None] = {}
    by_customer: dict[str, list[str]] = defaultdict(list)

    name_candidates: dict[str, set[str]] = defaultdict(set)
    for customer_id, customer in customer_map.items():
        for variant in customer_name_variants(customer.get("name")):
            name_candidates[variant].add(customer_id)

    for lead in rows(leads_source, "leads"):
        raw_lead_id = identifier(lead.get("lead_id"), "lead.lead_id")
        lead_id = short_id("fhs-lead", raw_lead_id)
        created_time = timestamp_text(lead.get("created_time"), "lead.created_time")
        lead_day = iso_day(created_time, "lead.created_time")
        if lead_day > cutoff:
            later_count += 1
            continue
        email_hash = hash_value(lead.get("email_sha256"), "lead email hash")
        phone_hash = hash_value(lead.get("phone_sha256"), "lead phone hash")
        matched_methods: dict[str, set[str]] = defaultdict(set)
        if email_hash:
            for customer_id in email_index.get(email_hash, set()):
                matched_methods[customer_id].add("email")
        if phone_hash:
            for customer_id in phone_index.get(phone_hash, set()):
                matched_methods[customer_id].add("phone")

        status = "confirmed" if matched_methods else "none"
        if not matched_methods:
            lead_name = normalized_name(lead.get("full_name"))
            for customer_id in name_candidates.get(lead_name, set()):
                future_days = []
                for lease in leases_by_customer.get(customer_id, []):
                    moved_in = optional_day(lease.get("move_in_date"), "lease.move_in_date")
                    if moved_in:
                        future_days.append((moved_in - lead_day).days)
                if any(0 <= difference <= 60 for difference in future_days):
                    matched_methods[customer_id].add("name and timing")
            if matched_methods:
                status = "possible"

        matches: list[dict[str, Any]] = []
        for customer_id in sorted(matched_methods):
            customer = customer_map[customer_id]
            methods = matched_methods[customer_id]
            via = "both" if methods == {"email", "phone"} else next(iter(methods)) if len(methods) == 1 else "name and timing"
            matches.append({
                "customer_id": customer_id,
                "customer_number": safe_text(customer.get("customer_number")),
                "company_id": identifier(customer.get("company_id"), "customer.company_id"),
                "via": via,
                **lease_timing(customer_id, lead_day, leases_by_customer, signed_by_lease, payment_by_customer),
            })
            by_customer[customer_id].append(lead_id)

        if status == "confirmed":
            method_labels = sorted({item["via"] for item in matches})
            label = f"Confirmed via {'/'.join(method_labels)}"
        elif status == "possible":
            label = "Possible match - unconfirmed"
        else:
            label = "No renter match"
        context = raw_campaign_context(lead, form_ads)
        campaign_key = short_id("fhs-campaign", context["raw_id"]) if context["raw_id"] else context["name"].lower().replace(" ", "-")
        raw_campaign_ids[campaign_key] = context["raw_id"]
        form_id = str(lead.get("form_id") or "")
        built.append({
            "id": lead_id,
            "created_time": created_time,
            "created_date": lead_day.isoformat(),
            "form": form_names.get(form_id, safe_text(lead.get("form_name") or "Unknown")),
            "campaign": {"key": campaign_key, "name": context["name"], "source": context["source"]},
            "adset": context["adset"],
            "ad": context["ad"],
            "platform": safe_text(lead.get("platform") or "Unknown"),
            "organic": bool(lead.get("is_organic")),
            "display_name": clean_name(lead.get("full_name")),
            "answers": safe_answers(lead.get("answers")),
            "match": {"status": status, "label": label, "multiple": len(matches) > 1, "matches": matches},
        })

    built.sort(key=lambda item: (item["created_time"], item["id"]), reverse=True)
    month_counts: dict[str, int] = defaultdict(int)
    for lead in built:
        month_counts[lead["created_date"][:7]] += 1
    reconciliation = [
        {"month": month, "lead_records": count, "meta_account_leads": meta_lead_count(meta, month)}
        for month, count in sorted(month_counts.items())
    ]
    confirmed = [lead for lead in built if lead["match"]["status"] == "confirmed"]
    possible = [lead for lead in built if lead["match"]["status"] == "possible"]
    already = [lead for lead in confirmed if any(item["timing"] == "already a tenant" for item in lead["match"]["matches"])]
    new_renters = [
        lead for lead in confirmed
        if not any(item["timing"] == "already a tenant" for item in lead["match"]["matches"])
        and any(item["days_to_move_in"] is not None for item in lead["match"]["matches"])
    ]
    move_days = [
        min(item["days_to_move_in"] for item in lead["match"]["matches"] if item["days_to_move_in"] is not None)
        for lead in new_renters
    ]
    reconciliation_note = "; ".join(
        f"{item['month']}: {item['lead_records']} lead records vs {item['meta_account_leads'] if item['meta_account_leads'] is not None else 'n/a'} Meta account leads"
        for item in reconciliation
    ) or "No lead records on or before the reporting cutoff."
    summary = {
        "leads": len(built),
        "confirmed": len(confirmed),
        "possible": len(possible),
        "none": len(built) - len(confirmed) - len(possible),
        "confirmed_new_renters": len(new_renters),
        "already_tenants": len(already),
        "median_days_to_move_in": statistics.median(move_days) if move_days else None,
        "later_leads_excluded": later_count,
        "reconciliation_note": reconciliation_note,
        "reconciliation": reconciliation,
    }

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for lead in built:
        grouped[lead["campaign"]["key"]].append(lead)
    by_campaign = []
    for campaign_key, campaign_leads in sorted(grouped.items(), key=lambda item: (-len(item[1]), item[0])):
        months = {lead["created_date"][:7] for lead in campaign_leads}
        spend_by_month = {
            month: float(round(month_spend, 2))
            for month in sorted(months)
            if (month_spend := meta_spend(meta, raw_campaign_ids.get(campaign_key), {month})) is not None
        }
        spend = sum((Decimal(str(value)) for value in spend_by_month.values()), Decimal("0")) if spend_by_month else None
        campaign_new = sum(1 for lead in campaign_leads if lead in new_renters)
        by_campaign.append({
            "key": campaign_key,
            "name": campaign_leads[0]["campaign"]["name"],
            "leads": len(campaign_leads),
            "confirmed_new_renters": campaign_new,
            "possible": sum(lead["match"]["status"] == "possible" for lead in campaign_leads),
            "meta_spend": None if spend is None else float(round(spend, 2)),
            "spend_by_month": spend_by_month,
            "spend_per_confirmed_renter": None if spend is None or campaign_new == 0 else float(round(spend / campaign_new, 2)),
            "cost_label": "At least - leads may use other contact details",
        })

    return {
        "schema": LEADS_SCHEMA,
        "cutoff": cutoff.isoformat(),
        "balancesAsOf": str(tenants.get("extractedAt"))[:10],
        "extractedAt": tenants.get("extractedAt"),
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "summary": summary,
        "byCampaign": by_campaign,
        "leads": built,
        "byCustomer": {customer_id: lead_ids for customer_id, lead_ids in sorted(by_customer.items())},
    }


def safe_path(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return "/"
    parsed = urlsplit(text)
    path = parsed.path if parsed.scheme or parsed.netloc else text.split("?", 1)[0].split("#", 1)[0]
    if not path.startswith("/"):
        path = "/" + path
    return path if not (CONTACT_RE.search(path) or LONG_DIGITS_RE.search(path) or IP_RE.search(path)) else "/[private-path-omitted]"


def first_touch(event: dict[str, Any]) -> dict[str, str]:
    groups = (
        (event.get("utm_source"), event.get("utm_medium"), event.get("utm_campaign")),
        (event.get("manual_source"), event.get("manual_medium"), event.get("manual_campaign")),
        (event.get("first_source"), event.get("first_medium"), event.get("first_campaign")),
    )
    for source, medium, campaign in groups:
        if source or medium or campaign:
            return {
                "source": safe_text(source or "(direct)"),
                "medium": safe_text(medium or "(none)"),
                "campaign": safe_text(campaign or "(not set)"),
            }
    return {"source": "(direct)", "medium": "(none)", "campaign": "(not set)"}


def event_touch(event: dict[str, Any]) -> dict[str, str]:
    touch = first_touch(event)
    return {} if touch["source"] == "(direct)" and touch["medium"] == "(none)" else touch


def iso_week(value: datetime) -> str:
    year, week, _weekday = value.isocalendar()
    return f"tenants-visitors-{year}-W{week:02d}.json"


def build_visitors(ga_source: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], set[str]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    raw_ids: set[str] = set()
    for event in rows(ga_source, "events"):
        raw_id = identifier(event.get("user_pseudo_id"), "event.user_pseudo_id")
        raw_ids.add(raw_id)
        grouped[raw_id].append(event)
    visitors: list[dict[str, Any]] = []
    week_files: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(dict)
    channel_counts: dict[tuple[str, str], int] = defaultdict(int)
    total_sessions = 0
    totals = {name: 0 for name in KEY_EVENTS}

    for raw_id, source_events in grouped.items():
        ordered = sorted(source_events, key=lambda event: parse_timestamp(event.get("event_timestamp"), "event.event_timestamp"))
        vid = visitor_id(raw_id)
        timestamps = [parse_timestamp(event.get("event_timestamp"), "event.event_timestamp") for event in ordered]
        session_values = []
        for event in ordered:
            value = str(event.get("ga_session_id") or "").strip()
            if value and value not in session_values:
                session_values.append(value)
        session_aliases = {value: f"s{index + 1}" for index, value in enumerate(session_values)}
        key_counts = {name: sum(str(event.get("event_name")) == name for event in ordered) for name in KEY_EVENTS}
        for name, count in key_counts.items():
            totals[name] += count
        touch = first_touch(ordered[0])
        channel_counts[(touch["source"], touch["medium"])] += 1
        portal_hosts = sorted({
            str(event.get("host") or "").lower()
            for event in ordered
            if str(event.get("host") or "").lower().endswith(".ccstorage.com") and not IP_RE.search(str(event.get("host") or ""))
        })
        week_file = iso_week(timestamps[0])
        timeline = []
        for event, timestamp in zip(ordered, timestamps):
            session_raw = str(event.get("ga_session_id") or "").strip()
            timeline_event = {
                "ts": timestamp.isoformat(timespec="seconds").replace("+00:00", "Z"),
                "name": safe_text(event.get("event_name") or "Unknown"),
                "session": session_aliases.get(session_raw, "unknown"),
                "host": safe_text(str(event.get("host") or "unknown").lower()),
                "path": safe_path(event.get("path")),
            }
            timeline_event.update(event_touch(event))
            timeline.append(timeline_event)
        week_files[week_file][vid] = timeline
        session_count = len(session_values)
        total_sessions += session_count
        visitors.append({
            "vid": vid,
            "first_seen": timestamps[0].isoformat(timespec="seconds").replace("+00:00", "Z"),
            "last_seen": timestamps[-1].isoformat(timespec="seconds").replace("+00:00", "Z"),
            "sessions": session_count,
            "pageviews": sum(str(event.get("event_name")) == "page_view" for event in ordered),
            "first_touch": touch,
            "landing_path": safe_path(ordered[0].get("path")),
            "has_gclid": any(bool(event.get("has_gclid")) for event in ordered),
            "has_fbclid": any(bool(event.get("has_fbclid")) for event in ordered),
            "device": safe_text(ordered[0].get("device") or "Unknown"),
            "city": safe_text(ordered[0].get("city") or "Unknown"),
            "region": safe_text(ordered[0].get("region") or "Unknown"),
            "key_events": key_counts,
            "portal_hosts": portal_hosts,
            "week_file": week_file,
        })
    visitors.sort(key=lambda item: (item["first_seen"], item["vid"]), reverse=True)
    start = iso_day(ga_source.get("start"), "GA4 start")
    through = iso_day(ga_source.get("through"), "GA4 through")
    summary = {
        "visitors": len(visitors),
        "sessions": total_sessions,
        "new_visitors": sum(visitor["sessions"] <= 1 for visitor in visitors),
        "returning_visitors": sum(visitor["sessions"] > 1 for visitor in visitors),
        "key_events": totals,
        "note": "Website visitors cannot be linked to named renters yet.",
    }
    channels = [
        {"source": source, "medium": medium, "label": f"{source} / {medium}", "visitors": count}
        for (source, medium), count in sorted(channel_counts.items(), key=lambda item: (-item[1], item[0]))
    ]
    index = {
        "schema": VISITORS_SCHEMA,
        "start": start.isoformat(),
        "through": through.isoformat(),
        "summary": summary,
        "channels": channels,
        "visitors": visitors,
    }
    return index, dict(week_files), raw_ids


def assert_private_output(
    artifacts: dict[str, Any], valid_customer_ids: set[str], raw_visitor_ids: Iterable[str]
) -> None:
    for filename, payload in artifacts.items():
        def visit(value: Any, path: str) -> None:
            if isinstance(value, dict):
                for key, child in value.items():
                    lowered = str(key).lower()
                    if any(part in lowered for part in FORBIDDEN_KEY_PARTS):
                        raise BuildError(f"forbidden output key {key!r} at {path}")
                    visit(child, f"{path}.{key}")
            elif isinstance(value, list):
                for index, child in enumerate(value):
                    visit(child, f"{path}[{index}]")
            elif isinstance(value, str):
                if "@" in value or HASH_RE.search(value) or LONG_DIGITS_RE.search(UUID_RE.sub("", value)):
                    raise BuildError(f"forbidden contact/hash pattern at {path}")
                if re.search(r"https?://|www\.|m\.me|messenger", value, re.I) or IP_RE.search(value):
                    raise BuildError(f"forbidden URL/IP value at {path}")
                if path.endswith(".path") and ("?" in value or "#" in value):
                    raise BuildError(f"query string or fragment at {path}")
        visit(payload, filename)
        compact = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        if "@" in compact or re.search(r"[0-9a-f]{64}", compact, re.I) or LONG_DIGITS_RE.search(UUID_RE.sub("", compact)):
            raise BuildError(f"forbidden contact/hash pattern in serialized {filename}")
        for raw_id in raw_visitor_ids:
            if len(raw_id) >= 6 and raw_id in compact:
                raise BuildError(f"raw visitor identifier leaked into {filename}")
    leads = artifacts.get("tenants-leads-index.json", {})
    for customer_id in leads.get("byCustomer", {}):
        if customer_id not in valid_customer_ids:
            raise BuildError(f"byCustomer references unknown customer {customer_id}")


def build_artifacts(
    tenants: dict[str, Any],
    contacts: dict[str, Any],
    leads_source: dict[str, Any],
    ga_source: dict[str, Any],
    reporting: dict[str, Any],
    meta: dict[str, Any],
) -> dict[str, Any]:
    leads = build_leads(tenants, contacts, leads_source, reporting, meta)
    visitors, weeks, raw_visitor_ids = build_visitors(ga_source)
    artifacts: dict[str, Any] = {"tenants-leads-index.json": leads, "tenants-visitors-index.json": visitors, **weeks}
    customer_ids = {identifier(customer.get("id"), "customer.id") for customer in rows(tenants, "customers")}
    assert_private_output(artifacts, customer_ids, raw_visitor_ids)
    return artifacts


def write_artifacts(output_dir: Path, artifacts: dict[str, Any]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    temporary: list[tuple[Path, Path]] = []
    try:
        for filename, payload in artifacts.items():
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", delete=False, dir=output_dir, suffix=".tmp") as handle:
                json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
                handle.write("\n")
                temporary.append((Path(handle.name), output_dir / filename))
        for staged, target in temporary:
            os.replace(staged, target)
    finally:
        for staged, _target in temporary:
            staged.unlink(missing_ok=True)


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise BuildError(f"{path} must contain a JSON object")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build restricted lead and visitor journey indexes")
    parser.add_argument("tenants_source", type=Path)
    parser.add_argument("contact_hashes", type=Path)
    parser.add_argument("meta_leads_source", type=Path)
    parser.add_argument("ga4_events", type=Path)
    parser.add_argument("reporting", type=Path)
    parser.add_argument("meta", type=Path)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        artifacts = build_artifacts(
            read_json(args.tenants_source),
            read_json(args.contact_hashes),
            read_json(args.meta_leads_source),
            read_json(args.ga4_events),
            read_json(args.reporting),
            read_json(args.meta),
        )
        write_artifacts(args.output_dir, artifacts)
    except (BuildError, json.JSONDecodeError, OSError, TypeError, ValueError) as exc:
        print(f"Journey build failed: {exc}", file=sys.stderr)
        return 1
    print(f"Wrote {len(artifacts)} restricted journey files to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
