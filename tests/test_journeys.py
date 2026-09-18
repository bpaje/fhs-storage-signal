from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"


def load_script(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


builder = load_script("build_journeys", ROOT / "scripts" / "build-journeys.py")


def fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def inputs():
    return (
        fixture("tenants-source.json"),
        fixture("journeys-contact-hashes.json"),
        fixture("journeys-meta-leads.json"),
        fixture("journeys-ga4-events.json"),
        fixture("tenants-reporting.json"),
        fixture("journeys-meta.json"),
    )


def build():
    return builder.build_artifacts(*inputs())


def test_hash_normalization_matches_documented_sql_rules():
    cases = [
        ("  AVERY@EXAMPLE.INVALID ", "avery@example.invalid", "52a5a9193d0a9f3c3501cf7fbd00801bb25cfb8112febe886b8a5629920fd388"),
        ("Morgan@Example.Invalid", "morgan@example.invalid", "54a0da2bd50d7b73012c0fc26dc4074e35ac749f08dcfb630affebc7cbf7abc3"),
    ]
    for raw, normalized, expected in cases:
        assert builder.normalize_email(raw) == normalized
        assert builder.sha256_hex(builder.normalize_email(raw)) == expected

    phone_cases = [
        (" +1 (555) 123-4567 ", "5551234567", "3c95277da5fd0da6a1a44ee3fdf56d20af6c6d242695a40e18e6e90dc3c5872c"),
        ("555-987-6543", "5559876543", "e1bfd73a5dc6262163ec42add4ebe0229f929db9b23644c1485dbccd05a36363"),
        ("123 456", None, None),
    ]
    for raw, normalized, expected in phone_cases:
        assert builder.normalize_phone(raw) == normalized
        assert builder.sha256_hex(builder.normalize_phone(raw)) == expected


def test_confirmed_possible_none_multiple_timing_and_fallback():
    index = build()["tenants-leads-index.json"]
    by_name = {row["display_name"]: row for row in index["leads"]}

    confirmed = by_name["Avery Example"]
    assert confirmed["match"]["status"] == "confirmed"
    assert confirmed["match"]["matches"][0]["via"] == "email"
    assert confirmed["match"]["matches"][0]["days_to_move_in"] == 14
    assert confirmed["campaign"]["name"] == "Synthetic Campaign"
    assert confirmed["campaign"]["source"] == "formAds"
    assert confirmed["ad"] == "Multiple ads"

    possible = by_name["Morgan Sample"]
    assert possible["match"]["status"] == "possible"
    assert possible["match"]["label"] == "Possible match - unconfirmed"
    assert possible["match"]["matches"][0]["days_to_move_in"] == 21

    already = by_name["Casey Fiction"]
    assert already["match"]["status"] == "confirmed"
    assert already["match"]["multiple"] is True
    assert any(match["timing"] == "already a tenant" for match in already["match"]["matches"])

    assert by_name["Taylor Fiction"]["match"]["status"] == "none"
    assert index["summary"]["later_leads_excluded"] == 1
    assert index["summary"]["confirmed_new_renters"] == 1
    assert index["summary"]["possible"] == 1
    assert index["summary"]["none"] == 1
    assert index["summary"]["median_days_to_move_in"] == 14
    assert "2 lead records vs 3 Meta account leads" in index["summary"]["reconciliation_note"]

    campaign = next(row for row in index["byCampaign"] if row["name"] == "Synthetic Campaign")
    assert campaign["meta_spend"] == 120.5
    assert campaign["spend_per_confirmed_renter"] == 120.5
    assert campaign["cost_label"].startswith("At least")

    swapped_inputs = list(inputs())
    next(customer for customer in swapped_inputs[0]["customers"] if customer["id"] == "customer-2")["name"] = "Sample, Morgan"
    swapped = builder.build_artifacts(*swapped_inputs)["tenants-leads-index.json"]
    swapped_possible = next(row for row in swapped["leads"] if row["display_name"] == "Morgan Sample")
    assert swapped_possible["match"]["status"] == "possible"


def test_forbidden_content_absent_from_every_output():
    artifacts = build()
    compact = json.dumps(artifacts, ensure_ascii=False, separators=(",", ":"))
    assert "pseudo-fixture" not in compact
    assert "inbox_url" not in compact.lower()
    assert "user_pseudo_id" not in compact
    assert "@" not in compact
    assert not re.search(r"[0-9a-f]{64}", compact, re.I)
    assert not re.search(r"\d{10,}", compact)
    assert "?ignored=yes" not in compact
    assert "1234567890123" not in compact

    visitors = artifacts["tenants-visitors-index.json"]
    alpha = next(row for row in visitors["visitors"] if row["sessions"] == 2)
    assert alpha["landing_path"] == "/storage"
    timeline = artifacts[alpha["week_file"]][alpha["vid"]]
    assert {event["session"] for event in timeline} == {"s1", "s2"}
    assert all("?" not in event["path"] for event in timeline)

    tenant_ids = {str(customer["id"]) for customer in fixture("tenants-source.json")["customers"]}
    assert set(artifacts["tenants-leads-index.json"]["byCustomer"]).issubset(tenant_ids)


def test_extracted_at_mismatch_aborts_and_writes_nothing():
    values = list(inputs())
    values[1]["extractedAt"] = "2026-09-11T00:00:00+00:00"
    names = [".journey-tenants.json", ".journey-contacts.json", ".journey-leads.json", ".journey-ga.json", ".journey-reporting.json", ".journey-meta.json"]
    paths = [ROOT / "tests" / name for name in names]
    sentinel = ROOT / "tests" / "tenants-leads-index.json"
    try:
        for path, value in zip(paths, values):
            path.write_text(json.dumps(value), encoding="utf-8")
        sentinel.write_text("last-good-output\n", encoding="utf-8")
        before = sentinel.read_bytes()
        with contextlib.redirect_stderr(io.StringIO()) as error:
            result = builder.main([*(str(path) for path in paths), "--output-dir", str(ROOT / "tests")])
        assert result == 1
        assert "extractedAt mismatch" in error.getvalue()
        assert sentinel.read_bytes() == before
        assert not (ROOT / "tests" / "tenants-visitors-index.json").exists()
    finally:
        for path in [*paths, sentinel]:
            path.unlink(missing_ok=True)


def test_private_fetchers_retain_paging_and_bomless_atomic_writes():
    meta = (ROOT / "private-scripts" / "fetch-meta-leads.ps1").read_text(encoding="utf-8")
    ga4 = (ROOT / "private-scripts" / "fetch-ga4-events.py").read_text(encoding="utf-8")
    assert "paging.next" in meta
    assert "(New-Object System.Text.UTF8Encoding $false)" in meta
    assert "Move-Item -LiteralPath $temporary" in meta
    assert "pageToken" in ga4 and "os.replace" in ga4
    assert "print(f\"events=" in ga4


def test_visitor_ids_never_form_a_phone_like_digit_run():
    # Raw 12-hex digests are all-digit about 1 time in 30 per 10-char window; the real 3,689-visitor
    # build hit one and aborted. Grouping in fours must make that impossible.
    for index in range(20000):
        vid = builder.visitor_id(f"synthetic-{index}")
        assert re.fullmatch(r"[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}", vid)
        assert not builder.LONG_DIGITS_RE.search(vid)


def test_uuid_with_all_digit_tail_passes_but_phone_like_text_still_fails():
    uuid = "0f3573fa-162e-409b-8ff1-735004301012"
    builder.assert_private_output({"tenants-leads-index.json": {"byCustomer": {uuid: ["lead-a"]}, "id": uuid}}, {uuid}, [])
    for bad in ("call 4045550123", "4045550123", uuid + " 4045550123"):
        try:
            builder.assert_private_output({"tenants-leads-index.json": {"note": bad}}, set(), [])
        except builder.BuildError:
            continue
        raise AssertionError(f"guard accepted phone-like text: {bad!r}")
