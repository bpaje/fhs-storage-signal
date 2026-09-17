"""Build restricted tenant indexes and profiles from a same-snapshot CCStorage extract.

Usage: py -3.14 scripts/build-tenants.py <tenants-source.json> <data/reporting.json>

The builder performs every contract and reconciliation check before writing. Money is
parsed and summed with Decimal; JSON money values remain two-decimal strings so no
binary floating-point conversion is introduced by the build.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "data" / "restricted"
SCHEMA = "storage-signal.tenants.v2"
CENT = Decimal("0.01")
ELIGIBLE_PAYMENT_STATUSES = {
    "Complete",
    "Manually Entered",
    "Partially Refunded",
    "Refunded",
}
FORBIDDEN_KEYS = {"email", "phone", "phone_number", "notes", "code", "pac"}
NAME_WITHHELD = "Name withheld"


class BuildError(ValueError):
    """A source, privacy, or reconciliation failure that prevents all writes."""


def clean_name(value: Any) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        return NAME_WITHHELD
    if "@" in text or sum(character.isdigit() for character in text) >= 7:
        return NAME_WITHHELD
    return text


CONTACT_WITHHELD = "Withheld (contact detail)"
EMAIL_LIKE = re.compile(r"[^\s@]+@[^\s@]+")
PHONE_LIKE = re.compile(r"(?<!\d)\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}(?!\d)")


def clean_address(value: Any) -> str | None:
    text = " ".join(str(value or "").split())
    if not text:
        return None
    if EMAIL_LIKE.search(text) or PHONE_LIKE.search(text):
        return CONTACT_WITHHELD
    return text


def identifier(value: Any, field: str) -> str:
    if value is None or isinstance(value, bool) or not str(value).strip():
        raise BuildError(f"{field} is required")
    return str(value).strip()


def decimal_value(value: Any, field: str) -> Decimal:
    if value is None or isinstance(value, bool):
        raise BuildError(f"{field} must be a decimal string")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise BuildError(f"{field} must be a decimal string") from exc
    if not parsed.is_finite():
        raise BuildError(f"{field} must be finite")
    return parsed.quantize(CENT, rounding=ROUND_HALF_UP)


def money(value: Any, field: str) -> str:
    return format(decimal_value(value, field), ".2f")


def iso_day(value: Any, field: str) -> date:
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError) as exc:
        raise BuildError(f"{field} must be an ISO date") from exc


def optional_day(value: Any, field: str) -> date | None:
    return None if value in (None, "") else iso_day(value, field)


def require_rows(source: dict[str, Any], key: str) -> list[dict[str, Any]]:
    rows = source.get(key)
    if not isinstance(rows, list):
        raise BuildError(f"source.{key} must be a list")
    if any(not isinstance(row, dict) for row in rows):
        raise BuildError(f"source.{key} must contain objects")
    return rows


def unique_map(rows: Iterable[dict[str, Any]], key: str, label: str) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for row in rows:
        row_id = identifier(row.get(key), f"{label}.{key}")
        if row_id in output:
            raise BuildError(f"Duplicate {label} {row_id}")
        output[row_id] = row
    return output


def reporting_contract(reporting: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, dict[str, dict[str, Any]]], list[dict[str, str]]]:
    periods = reporting.get("periods")
    if not isinstance(periods, list) or not periods:
        raise BuildError("reporting.json has no periods")
    by_period: dict[str, dict[str, dict[str, Any]]] = {}
    facility_names: dict[str, str] = {}
    for period in periods:
        period_id = str(period.get("id") or "")
        if not re.fullmatch(r"\d{4}-\d{2}", period_id) or period_id in by_period:
            raise BuildError(f"Invalid or duplicate reporting period {period_id!r}")
        start = iso_day(period.get("start"), f"{period_id}.start")
        end = iso_day(period.get("end"), f"{period_id}.end")
        if start > end or start.strftime("%Y-%m") != period_id or end.strftime("%Y-%m") != period_id:
            raise BuildError(f"Reporting period {period_id} has invalid bounds")
        roster: dict[str, dict[str, Any]] = {}
        for facility in period.get("facilities", []):
            company_id = identifier(facility.get("id"), f"{period_id}.facility.id")
            if company_id in roster:
                raise BuildError(f"Duplicate facility {company_id} in {period_id}")
            roster[company_id] = facility
            facility_names[company_id] = str(facility.get("name") or company_id)
        by_period[period_id] = roster
    facilities = [{"id": key, "name": facility_names[key]} for key in sorted(facility_names, key=lambda item: facility_names[item].casefold())]
    return periods, by_period, facilities


def period_for_day(day: date, periods: list[dict[str, Any]]) -> str | None:
    for period in periods:
        if iso_day(period["start"], "period.start") <= day <= iso_day(period["end"], "period.end"):
            return str(period["id"])
    return None


def customer_status(customer_id: str, leases_by_customer: dict[str, list[dict[str, Any]]], cutoff: date) -> str:
    for lease in leases_by_customer.get(customer_id, []):
        if lease.get("void") is not False:
            continue
        moved_in = optional_day(lease.get("move_in_date"), "lease.move_in_date")
        moved_out = optional_day(lease.get("move_out_date"), "lease.move_out_date")
        if moved_in and moved_in <= cutoff and (moved_out is None or moved_out >= cutoff):
            return "Current"
    return "Moved out"


def safe_text(value: Any, fallback: str = "Not recorded") -> str:
    text = " ".join(str(value or "").split())
    return text or fallback


def build_artifacts(source: dict[str, Any], reporting: dict[str, Any]) -> dict[str, dict[str, Any]]:
    extracted_at = source.get("extractedAt")
    if not extracted_at or extracted_at != reporting.get("ccExtractedAt"):
        raise BuildError(
            "extractedAt mismatch: "
            f"source={extracted_at!r} reporting.ccExtractedAt={reporting.get('ccExtractedAt')!r}"
        )
    cutoff = iso_day(source.get("cutoff"), "source.cutoff")
    # Balances, autopay and lease status are the source's current state at extraction, not at the activity cutoff.
    as_of = iso_day(str(extracted_at)[:10], "source.extractedAt")
    if as_of < cutoff:
        raise BuildError(f"extractedAt {as_of} precedes cutoff {cutoff}")
    periods, roster_by_period, facilities = reporting_contract(reporting)
    roster_ids = {facility["id"] for facility in facilities}

    customers = require_rows(source, "customers")
    leases = require_rows(source, "leases")
    unit_types = require_rows(source, "unitTypes")
    signed_rows = require_rows(source, "leaseSigned")
    rate_changes = require_rows(source, "rateChanges")
    discounts = require_rows(source, "leaseDiscounts")
    protection = require_rows(source, "leaseProtection")
    deposits = require_rows(source, "securityDeposits")
    autopay_rows = require_rows(source, "autopay")
    invoices = require_rows(source, "invoices")
    invoice_leases = require_rows(source, "invoiceLeases")
    payments = require_rows(source, "payments")
    occupancy_daily = require_rows(source, "occupancyDaily")

    customer_map = unique_map(customers, "id", "customer")
    lease_map = unique_map(leases, "id", "lease")
    invoice_map = unique_map(invoices, "id", "invoice")
    unique_map(payments, "id", "payment")
    for customer_id, customer in customer_map.items():
        company_id = identifier(customer.get("company_id"), "customer.company_id")
        if company_id not in roster_ids:
            raise BuildError(f"Customer {customer_id} uses facility {company_id} outside the reporting roster")

    unit_type_map: dict[tuple[str, str], dict[str, Any]] = {}
    for row in unit_types:
        key = (identifier(row.get("company_id"), "unitType.company_id"), identifier(row.get("id"), "unitType.id"))
        if key in unit_type_map:
            raise BuildError(f"Duplicate unit type {key[1]} for facility {key[0]}")
        unit_type_map[key] = row

    leases_by_customer: dict[str, list[dict[str, Any]]] = defaultdict(list)
    invoices_by_customer: dict[str, list[dict[str, Any]]] = defaultdict(list)
    payments_by_customer: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for lease in leases:
        company_id = identifier(lease.get("company_id"), "lease.company_id")
        customer_id = identifier(lease.get("customer_id"), "lease.customer_id")
        if company_id not in roster_ids:
            raise BuildError(f"Lease {lease.get('id')} uses facility {company_id} outside the reporting roster")
        customer = customer_map.get(customer_id)
        if not customer:
            raise BuildError(f"Lease {lease.get('id')} references unknown customer {customer_id}")
        if identifier(customer.get("company_id"), "customer.company_id") != company_id:
            raise BuildError(f"Lease {lease.get('id')} and customer {customer_id} have different facilities")
        leases_by_customer[customer_id].append(lease)
    for invoice in invoices:
        customer_id = identifier(invoice.get("customer_id"), "invoice.customer_id")
        if customer_id not in customer_map:
            raise BuildError(f"Invoice {invoice.get('id')} references unknown customer {customer_id}")
        if identifier(invoice.get("company_id"), "invoice.company_id") != identifier(customer_map[customer_id].get("company_id"), "customer.company_id"):
            raise BuildError(f"Invoice {invoice.get('id')} and customer {customer_id} have different facilities")
        invoices_by_customer[customer_id].append(invoice)
    for payment in payments:
        customer_id = identifier(payment.get("customer_id"), "payment.customer_id")
        if customer_id not in customer_map:
            raise BuildError(f"Payment {payment.get('id')} references unknown customer {customer_id}")
        if identifier(payment.get("company_id"), "payment.company_id") != identifier(customer_map[customer_id].get("company_id"), "customer.company_id"):
            raise BuildError(f"Payment {payment.get('id')} and customer {customer_id} have different facilities")
        payments_by_customer[customer_id].append(payment)

    signed_by_lease: dict[str, list[dict[str, Any]]] = defaultdict(list)
    rates_by_lease: dict[str, list[dict[str, Any]]] = defaultdict(list)
    discounts_by_lease: dict[str, list[dict[str, Any]]] = defaultdict(list)
    protection_by_lease: dict[str, list[dict[str, Any]]] = defaultdict(list)
    deposits_by_lease: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rows, bucket, label in (
        (signed_rows, signed_by_lease, "leaseSigned"),
        (rate_changes, rates_by_lease, "rateChanges"),
        (discounts, discounts_by_lease, "leaseDiscounts"),
        (protection, protection_by_lease, "leaseProtection"),
        (deposits, deposits_by_lease, "securityDeposits"),
    ):
        for row in rows:
            lease_id = identifier(row.get("lease_id"), f"{label}.lease_id")
            if lease_id not in lease_map:
                raise BuildError(f"{label} references unknown lease {lease_id}")
            bucket[lease_id].append(row)

    invoices_by_lease: dict[str, list[dict[str, Any]]] = defaultdict(list)
    leases_by_invoice: dict[str, list[str]] = defaultdict(list)
    for link in invoice_leases:
        invoice_id = identifier(link.get("invoice_id"), "invoiceLeases.invoice_id")
        lease_id = identifier(link.get("lease_id"), "invoiceLeases.lease_id")
        if invoice_id not in invoice_map or lease_id not in lease_map:
            raise BuildError(f"Invalid invoice/lease link {invoice_id}/{lease_id}")
        invoices_by_lease[lease_id].append(invoice_map[invoice_id])
        leases_by_invoice[invoice_id].append(lease_id)

    autopay_by_customer: dict[str, bool] = {}
    for row in autopay_rows:
        customer_id = identifier(row.get("customer_id"), "autopay.customer_id")
        if customer_id not in customer_map:
            raise BuildError(f"Autopay references unknown customer {customer_id}")
        if customer_id in autopay_by_customer:
            raise BuildError(f"Duplicate autopay row for customer {customer_id}")
        autopay_by_customer[customer_id] = bool(row.get("active"))

    index: dict[str, Any] = {
        "schema": SCHEMA,
        "cutoff": cutoff.isoformat(),
        "balancesAsOf": as_of.isoformat(),
        "extractedAt": extracted_at,
        "facilities": facilities,
        "moveIns": [],
        "moveOuts": [],
        "payments": [],
        "pastDue": [],
        "rateChanges": [],
        "occupancyDaily": [],
    }
    facility_names = {row["id"]: row["name"] for row in facilities}
    statuses = {customer_id: customer_status(customer_id, leases_by_customer, as_of) for customer_id in customer_map}

    for lease_id, lease in lease_map.items():
        if lease.get("void") is not False:
            continue
        company_id = identifier(lease.get("company_id"), "lease.company_id")
        customer_id = identifier(lease.get("customer_id"), "lease.customer_id")
        customer = customer_map[customer_id]
        common = {
            "company_id": company_id,
            "facility": facility_names[company_id],
            "customer_id": customer_id,
            "customer_number": safe_text(customer.get("customer_number")),
            "name": clean_name(customer.get("name")),
            "lease_number": safe_text(lease.get("lease_number")),
            "unit": safe_text(lease.get("unit_name")),
            "unitType": safe_text(lease.get("unit_type")),
            "rate": money(lease.get("cash_price"), f"lease {lease_id} cash_price"),
            "tenantStatus": statuses[customer_id],
        }
        moved_in = optional_day(lease.get("move_in_date"), f"lease {lease_id} move_in_date")
        moved_out = optional_day(lease.get("move_out_date"), f"lease {lease_id} move_out_date")
        if moved_in and moved_in <= cutoff:
            linked = sorted(
                invoices_by_lease.get(lease_id, []),
                key=lambda row: (str(row.get("created_at") or ""), str(row.get("due_date") or ""), str(row.get("id") or "")),
            )
            first_invoice = linked[0] if linked else None
            move_in_invoice = None if first_invoice is None else {
                "invoice_number": safe_text(first_invoice.get("invoice_number")),
                "total_billed": money(first_invoice.get("total_billed"), "move-in invoice total_billed"),
                "total_paid": money(first_invoice.get("total_paid"), "move-in invoice total_paid"),
            }
            index["moveIns"].append({"date": moved_in.isoformat(), **common, "moveInInvoice": move_in_invoice})
        if moved_out and moved_out <= cutoff:
            index["moveOuts"].append({"date": moved_out.isoformat(), **common, "move_in_date": moved_in.isoformat() if moved_in else None})

    for payment in payments:
        if payment.get("status") not in ELIGIBLE_PAYMENT_STATUSES:
            continue
        effective_day = iso_day(payment.get("effective_date"), "payment.effective_date")
        if effective_day > cutoff:
            continue
        customer_id = identifier(payment.get("customer_id"), "payment.customer_id")
        customer = customer_map[customer_id]
        company_id = identifier(payment.get("company_id"), "payment.company_id")
        index["payments"].append({
            "company_id": company_id,
            "facility": facility_names[company_id],
            "date": effective_day.isoformat(),
            "customer_id": customer_id,
            "customer_number": safe_text(customer.get("customer_number")),
            "name": clean_name(customer.get("name")),
            "payment_number": safe_text(payment.get("payment_number")),
            "payment_method": safe_text(payment.get("payment_method")),
            "status": safe_text(payment.get("status")),
            "original_amount": money(payment.get("original_amount"), "payment.original_amount"),
            "refund_amount": money(payment.get("refund_amount"), "payment.refund_amount"),
            "effective_amount": money(payment.get("effective_amount"), "payment.effective_amount"),
            "source": safe_text(payment.get("source")),
        })

    for invoice in invoices:
        due = iso_day(invoice.get("due_date"), "invoice.due_date")
        balance = decimal_value(invoice.get("balance_due"), "invoice.balance_due")
        if balance <= 0 or due >= as_of:
            continue
        customer_id = identifier(invoice.get("customer_id"), "invoice.customer_id")
        customer = customer_map[customer_id]
        company_id = identifier(invoice.get("company_id"), "invoice.company_id")
        lease_ids = sorted(leases_by_invoice.get(str(invoice.get("id")), []))
        lease = lease_map.get(str(lease_ids[0])) if lease_ids else None
        index["pastDue"].append({
            "company_id": company_id,
            "facility": facility_names[company_id],
            "date": due.isoformat(),
            "customer_id": customer_id,
            "customer_number": safe_text(customer.get("customer_number")),
            "name": clean_name(customer.get("name")),
            "invoice_number": safe_text(invoice.get("invoice_number")),
            "lease_number": safe_text(lease.get("lease_number")) if lease else None,
            "unit": safe_text(lease.get("unit_name")) if lease else None,
            "balance_due": format(balance, ".2f"),
            "days_late": (as_of - due).days,
            "tenantStatus": statuses[customer_id],
        })

    for change in rate_changes:
        lease_id = identifier(change.get("lease_id"), "rateChanges.lease_id")
        lease = lease_map[lease_id]
        customer_id = identifier(lease.get("customer_id"), "lease.customer_id")
        customer = customer_map[customer_id]
        company_id = identifier(lease.get("company_id"), "lease.company_id")
        effective = iso_day(change.get("effective_date"), "rateChanges.effective_date")
        index["rateChanges"].append({
            "company_id": company_id,
            "facility": facility_names[company_id],
            "date": effective.isoformat(),
            "customer_id": customer_id,
            "customer_number": safe_text(customer.get("customer_number")),
            "name": clean_name(customer.get("name")),
            "lease_number": safe_text(lease.get("lease_number")),
            "unit": safe_text(lease.get("unit_name")),
            "unitType": safe_text(lease.get("unit_type")),
            "old_rate": money(change.get("old_rate"), "rateChanges.old_rate"),
            "new_rate": money(change.get("new_rate"), "rateChanges.new_rate"),
            "applied_at": change.get("applied_at"),
            "upcoming": effective > as_of,
        })

    occupancy_seen: set[tuple[str, str]] = set()
    for row in occupancy_daily:
        company_id = identifier(row.get("company_id"), "occupancyDaily.company_id")
        day = iso_day(row.get("date"), "occupancyDaily.date")
        key = (company_id, day.isoformat())
        if company_id not in roster_ids or key in occupancy_seen:
            raise BuildError(f"Invalid or duplicate occupancy row for facility {company_id} on {day}")
        occupancy_seen.add(key)
        index["occupancyDaily"].append({
            "company_id": company_id,
            "facility": facility_names[company_id],
            "date": day.isoformat(),
            "leases": int(row.get("leases")),
            "auto_pay_leases": int(row.get("auto_pay_leases")),
            "storage_units": int(row.get("storage_units")),
        })

    for key in ("moveIns", "moveOuts", "payments", "pastDue", "rateChanges", "occupancyDaily"):
        index[key].sort(key=lambda row: (row["date"], row["facility"], str(row.get("customer_number") or "")))

    artifacts: dict[str, dict[str, Any]] = {"tenants-index.json": index}
    customers_by_company: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for customer in customers:
        customers_by_company[identifier(customer.get("company_id"), "customer.company_id")].append(customer)

    for facility in facilities:
        company_id = facility["id"]
        profiles: dict[str, Any] = {}
        for customer in customers_by_company.get(company_id, []):
            customer_id = identifier(customer.get("id"), "customer.id")
            customer_leases = leases_by_customer.get(customer_id, [])
            customer_invoices = invoices_by_customer.get(customer_id, [])
            customer_payments = payments_by_customer.get(customer_id, [])
            move_in_days = [iso_day(row["move_in_date"], "lease.move_in_date") for row in customer_leases if row.get("void") is False and row.get("move_in_date")]
            open_balance = sum((decimal_value(row.get("balance_due"), "invoice.balance_due") for row in customer_invoices if decimal_value(row.get("balance_due"), "invoice.balance_due") > 0), Decimal("0"))
            past_due = sum((decimal_value(row.get("balance_due"), "invoice.balance_due") for row in customer_invoices if decimal_value(row.get("balance_due"), "invoice.balance_due") > 0 and iso_day(row.get("due_date"), "invoice.due_date") < as_of), Decimal("0"))
            eligible = [row for row in customer_payments if row.get("status") in ELIGIBLE_PAYMENT_STATUSES and iso_day(row.get("effective_date"), "payment.effective_date") <= cutoff]
            lifetime_paid = sum((decimal_value(row.get("effective_amount"), "payment.effective_amount") for row in eligible), Decimal("0"))
            payment_days = [iso_day(row.get("effective_date"), "payment.effective_date") for row in eligible]

            profile_leases = []
            for lease in sorted(customer_leases, key=lambda row: str(row.get("move_in_date") or ""), reverse=True):
                lease_id = identifier(lease.get("id"), "lease.id")
                unit_type = unit_type_map.get((company_id, str(lease.get("storage_unit_type_id") or "")))
                profile_leases.append({
                    "lease_number": safe_text(lease.get("lease_number")),
                    "unit": safe_text(lease.get("unit_name")),
                    "unitType": {
                        "name": safe_text((unit_type or {}).get("name") or lease.get("unit_type")),
                        "length": (unit_type or {}).get("length"),
                        "width": (unit_type or {}).get("width"),
                        "amenities": [part.strip() for part in str((unit_type or {}).get("amenities") or "").split(",") if part.strip()],
                    },
                    "signedDate": min((str(row.get("accepted_at")) for row in signed_by_lease.get(lease_id, []) if row.get("accepted_at")), default=None),
                    "move_in_date": lease.get("move_in_date"),
                    "move_out_date": lease.get("move_out_date"),
                    "scheduled_move_out": lease.get("scheduled_move_out"),
                    "next_bill_date": lease.get("next_bill_date"),
                    "billing_interval": safe_text(lease.get("billing_interval")),
                    "currentRate": money(lease.get("cash_price"), "lease.cash_price"),
                    "auction_date": lease.get("auction_date"),
                    "rateHistory": [{
                        "old_rate": money(row.get("old_rate"), "rateChanges.old_rate"),
                        "new_rate": money(row.get("new_rate"), "rateChanges.new_rate"),
                        "effective_date": row.get("effective_date"),
                        "applied_at": row.get("applied_at"),
                    } for row in sorted(rates_by_lease.get(lease_id, []), key=lambda row: str(row.get("effective_date") or ""), reverse=True)],
                    "discounts": [{key: row.get(key) for key in ("discount_name", "active_start", "active_end")} for row in discounts_by_lease.get(lease_id, [])],
                    "protection": [{
                        "plan_name": row.get("plan_name"),
                        "monthly_amount": money(row.get("monthly_amount"), "leaseProtection.monthly_amount"),
                        "coverage_amount": money(row.get("coverage_amount"), "leaseProtection.coverage_amount"),
                        "active_start": row.get("active_start"),
                        "active_end": row.get("active_end"),
                    } for row in protection_by_lease.get(lease_id, [])],
                    "deposits": [{
                        "collected_amount": money(row.get("collected_amount"), "securityDeposits.collected_amount"),
                        "returned_amount": None if row.get("returned_amount") is None else money(row.get("returned_amount"), "securityDeposits.returned_amount"),
                        "collected_at": row.get("collected_at"),
                        "returned_at": row.get("returned_at"),
                    } for row in deposits_by_lease.get(lease_id, [])],
                })

            profile_invoices = [{
                "invoice_number": safe_text(row.get("invoice_number")),
                "total_billed": money(row.get("total_billed"), "invoice.total_billed"),
                "total_paid": money(row.get("total_paid"), "invoice.total_paid"),
                "balance_due": money(row.get("balance_due"), "invoice.balance_due"),
                "due_date": row.get("due_date"),
                "created_at": row.get("created_at"),
            } for row in sorted(customer_invoices, key=lambda row: (decimal_value(row.get("balance_due"), "invoice.balance_due") <= 0, str(row.get("due_date") or "")))]
            profile_payments = [{
                "payment_number": safe_text(row.get("payment_number")),
                "payment_method": safe_text(row.get("payment_method")),
                "status": safe_text(row.get("status")),
                "original_amount": money(row.get("original_amount"), "payment.original_amount"),
                "refund_amount": money(row.get("refund_amount"), "payment.refund_amount"),
                "effective_amount": money(row.get("effective_amount"), "payment.effective_amount"),
                "effective_date": row.get("effective_date"),
                "source": safe_text(row.get("source")),
            } for row in sorted(customer_payments, key=lambda row: str(row.get("effective_date") or ""), reverse=True)]

            profiles[customer_id] = {
                "customer_id": customer_id,
                "company_id": company_id,
                "customer_number": safe_text(customer.get("customer_number")),
                "name": clean_name(customer.get("name")),
                "address": clean_address(customer.get("address")),
                "address2": clean_address(customer.get("address2")),
                "city": clean_address(customer.get("city")),
                "state": customer.get("state"),
                "postal_code": customer.get("postal_code"),
                "alternate_contact_name": clean_name(customer.get("alternate_contact_name")) if " ".join(str(customer.get("alternate_contact_name") or "").split()) else None,
                "flags": {
                    "active_military": bool(customer.get("active_military")),
                    "do_not_rent": bool(customer.get("do_not_rent")),
                    "tax_exempt": bool(customer.get("tax_exempt")),
                },
                "pricing_type": customer.get("pricing_type"),
                "autopay": autopay_by_customer.get(customer_id, False),
                "tenantStatus": statuses[customer_id],
                "tenantSince": min(move_in_days).isoformat() if move_in_days else None,
                "balanceDue": format(open_balance, ".2f"),
                "pastDue": format(past_due, ".2f"),
                "lifetimePaid": format(lifetime_paid, ".2f"),
                "firstPaymentDate": min(payment_days).isoformat() if payment_days else None,
                "leases": profile_leases,
                "invoices": profile_invoices,
                "payments": profile_payments,
            }
        artifacts[f"tenants-{company_id}.json"] = {
            "schema": SCHEMA,
            "cutoff": cutoff.isoformat(),
            "extractedAt": extracted_at,
            "facility": facility,
            "profiles": profiles,
        }

    reconcile(source, reporting, periods, roster_by_period)
    assert_no_forbidden_keys(artifacts)
    return artifacts


def reconcile(source: dict[str, Any], reporting: dict[str, Any], periods: list[dict[str, Any]], roster_by_period: dict[str, dict[str, dict[str, Any]]]) -> None:
    moves: dict[tuple[str, str, str], int] = defaultdict(int)
    payment_count: dict[tuple[str, str], int] = defaultdict(int)
    payment_net: dict[tuple[str, str], Decimal] = defaultdict(Decimal)
    occupancy: dict[tuple[str, str], dict[str, Any]] = {}
    for lease in source["leases"]:
        if lease.get("void") is not False:
            continue
        company_id = identifier(lease.get("company_id"), "lease.company_id")
        for field, metric in (("move_in_date", "moveIns"), ("move_out_date", "moveOuts")):
            if lease.get(field):
                period_id = period_for_day(iso_day(lease[field], f"lease.{field}"), periods)
                if period_id:
                    moves[(period_id, company_id, metric)] += 1
    for payment in source["payments"]:
        if payment.get("status") not in ELIGIBLE_PAYMENT_STATUSES:
            continue
        period_id = period_for_day(iso_day(payment.get("effective_date"), "payment.effective_date"), periods)
        if period_id:
            company_id = identifier(payment.get("company_id"), "payment.company_id")
            payment_count[(period_id, company_id)] += 1
            payment_net[(period_id, company_id)] += decimal_value(payment.get("effective_amount"), "payment.effective_amount")
    for row in source["occupancyDaily"]:
        occupancy[(identifier(row.get("company_id"), "occupancyDaily.company_id"), str(row.get("date")))] = row

    mismatches: list[str] = []
    for period in periods:
        period_id = str(period["id"])
        for company_id, facility in roster_by_period[period_id].items():
            for metric in ("moveIns", "moveOuts"):
                actual = moves[(period_id, company_id, metric)]
                expected = facility.get(metric)
                if actual != expected:
                    mismatches.append(f"{period_id} facility {company_id} {metric}: expected={expected!r} actual={actual!r}")
            actual_count: int | None = payment_count[(period_id, company_id)]
            actual_net: Decimal | None = payment_net[(period_id, company_id)].quantize(CENT)
            if facility.get("payments") is None and actual_count == 0:
                actual_count = None
                actual_net = None
            expected_net = None if facility.get("net") is None else decimal_value(facility.get("net"), "reporting.net")
            if actual_count != facility.get("payments"):
                mismatches.append(f"{period_id} facility {company_id} payments: expected={facility.get('payments')!r} actual={actual_count!r}")
            if actual_net != expected_net:
                mismatches.append(f"{period_id} facility {company_id} net: expected={expected_net!r} actual={actual_net!r}")
            expected_leases, expected_units = facility.get("leases"), facility.get("units")
            if expected_leases is not None or expected_units is not None:
                row = occupancy.get((company_id, str(period["end"])))
                actual_leases = None if row is None else int(row.get("leases"))
                actual_units = None if row is None else int(row.get("storage_units"))
                if actual_leases != expected_leases:
                    mismatches.append(f"{period_id} facility {company_id} occupancy leases: expected={expected_leases!r} actual={actual_leases!r}")
                if actual_units != expected_units:
                    mismatches.append(f"{period_id} facility {company_id} storage units: expected={expected_units!r} actual={actual_units!r}")
    if mismatches:
        for mismatch in mismatches:
            print(f"RECONCILIATION MISMATCH: {mismatch}", file=sys.stderr)
        raise BuildError(f"Tenant reconciliation failed with {len(mismatches)} mismatch(es)")


def assert_no_forbidden_keys(value: Any, path: str = "output") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).lower() in FORBIDDEN_KEYS:
                raise BuildError(f"Forbidden output key {key!r} at {path}")
            assert_no_forbidden_keys(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_no_forbidden_keys(child, f"{path}[{index}]")


def write_artifacts(output_dir: Path, artifacts: dict[str, dict[str, Any]]) -> None:
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
            if staged.exists():
                staged.unlink()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build restricted tenant indexes and profiles")
    parser.add_argument("tenants_source", type=Path)
    parser.add_argument("reporting", type=Path)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        source = json.loads(args.tenants_source.read_text(encoding="utf-8-sig"))
        reporting = json.loads(args.reporting.read_text(encoding="utf-8-sig"))
        artifacts = build_artifacts(source, reporting)
        write_artifacts(args.output_dir, artifacts)
    except (BuildError, json.JSONDecodeError, OSError, TypeError, ValueError) as exc:
        print(f"Tenant build failed: {exc}", file=sys.stderr)
        return 1
    print(f"Wrote {len(artifacts)} restricted tenant files to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
