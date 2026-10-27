from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_sources", ROOT / "scripts" / "build-sources.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

EXTRACTED = "2026-09-30T12:00:00.000+00:00"


def row(n, customer="c1", day="2026-09-10", credited=None, online=False, online_slug=None, company=1):
    return {"company_id": company, "lease_id": f"lease-{n}", "customer_id": customer, "move_in_date": day,
            "credited_slug": credited, "online": online, "online_slug": online_slug, "online_converted": online}


def source(rows, extracted=EXTRACTED, cutoff="2026-09-30"):
    return {"extractedAt": extracted, "cutoff": cutoff, "fields": builder.FIELDS, "rows": rows}


def reporting(counts=None, extracted=EXTRACTED):
    counts = counts or {"1": 0}
    return {"ccExtractedAt": extracted, "periods": [{"id": "2026-09", "start": "2026-09-01", "end": "2026-09-30",
                                                      "facilities": [{"id": fid, "moveIns": n} for fid, n in counts.items()]}]}


def lead(customer, campaign_key="k-meta", timing="moved in after lead", move_in="2026-09-10", created="2026-09-01",
         created_time="2026-09-01T10:00:00+0000", signed=None):
    return {"created_date": created, "created_time": created_time, "campaign": {"key": campaign_key},
            "match": {"status": "confirmed", "matches": [{"customer_id": customer, "timing": timing, "move_in_date": move_in, "lease_signed": signed}]}}


def leads(*items, extracted=EXTRACTED):
    return {"extractedAt": extracted, "leads": list(items)}


def run(rows, lead_items=(), counts=None, mapping=None, meta=None, google=None, **kwargs):
    counts = counts if counts is not None else {"1": len(rows)}
    return builder.build(source(rows, **{k: v for k, v in kwargs.items() if k in ("extracted", "cutoff")}), reporting(counts, kwargs.get("report_extracted", EXTRACTED)),
                         leads(*lead_items, extracted=kwargs.get("leads_extracted", EXTRACTED)), mapping or {}, meta or {}, google or {})


def portfolio(result):
    return result["periods"][0]["portfolio"]


def mapping_for(slug, meta=(), google=()):
    return {slug: {"meta": list(meta), "google": list(google)}}


def test_precedence_counts_each_move_in_once():
    rows = [row(1, "c1", credited="gads_albany_search"), row(2, "c2", credited="x"), row(3, "c3", online=True, online_slug="fb_book_now"),
            row(4, "c4", online=True), row(5, "c5")]
    result = portfolio(run(rows, [lead("c1")]))
    assert result["moveIns"] == 5
    assert (result["confirmed"], result["creditedLease"], result["creditedOnline"], result["notRecorded"], result["notRecordedOnline"]) == (1, 1, 1, 2, 1)
    assert result["confirmed"] + result["disagree"] + result["creditedLease"] + result["creditedOnline"] + result["notRecorded"] == result["moveIns"]


def test_disagreement_is_its_own_row_and_no_winner_is_picked():
    meta_key = builder.short_id("fhs-campaign", "111")
    mapped = mapping_for("fb_book_now", meta=["222"])
    result = portfolio(run([row(1, "c1", credited="fb_book_now")], [lead("c1", campaign_key=meta_key)], mapping=mapped))
    assert (result["disagree"], result["confirmed"], result["creditedLease"]) == (1, 0, 0)
    agree = portfolio(run([row(1, "c1", credited="fb_book_now")], [lead("c1", campaign_key=meta_key)], mapping=mapping_for("fb_book_now", meta=["111"])))
    assert (agree["disagree"], agree["confirmed"]) == (0, 1)
    unmapped = portfolio(run([row(1, "c1", credited="fb_book_now")], [lead("c1", campaign_key=meta_key)]))
    assert (unmapped["disagree"], unmapped["confirmed"]) == (0, 1)


def test_lead_timing_rules():
    for timing, move_in, signed, expected in [
        ("already a tenant", "2026-09-10", None, 0),
        ("no move-in yet", None, None, 0),
        ("already a tenant", "2026-09-10", "2026-09-10T18:00:00Z", 1),
        ("already a tenant", "2026-09-10", "2026-09-10T08:00:00Z", 0),
    ]:
        item = lead("c1", timing=timing, move_in=move_in, created="2026-09-10", created_time="2026-09-10T12:00:00+0000", signed=signed)
        assert portfolio(run([row(1, "c1", day="2026-09-10")], [item]))["confirmed"] == expected, (timing, signed)


def test_one_lead_confirms_one_move_in_and_other_dates_do_not_match():
    rows = [row(1, "c1"), row(2, "c1")]
    assert portfolio(run(rows, [lead("c1")]))["confirmed"] == 1
    assert portfolio(run(rows, [lead("c1", move_in="2026-09-11")]))["confirmed"] == 0


def test_not_recorded_online_never_exceeds_not_recorded():
    result = portfolio(run([row(i, f"c{i}", online=True) for i in range(4)] + [row(9, "c9")]))
    assert result["notRecorded"] == 5 and result["notRecordedOnline"] == 4


def test_no_combined_attribution_number_and_no_personal_data():
    result = run([row(1, "c1", credited="a"), row(2, "c2")], [lead("c1")])
    text = json.dumps(result)
    for banned in ("attributed", "total", "customer_id", "lease_id", "email", "phone", "c1", "c2", "lease-"):
        assert banned not in text, banned
    assert set(portfolio(result)) == set(builder.COUNT_KEYS) | {"creditedBySlug"}


def test_reconciliation_guard_refuses_a_move_in_mismatch():
    with pytest.raises(builder.SourcesError, match="move-ins in the extract"):
        run([row(1)], counts={"1": 2})
    with pytest.raises(builder.SourcesError, match="missing from reporting"):
        run([row(1, company=9)], counts={"1": 0})


def test_extraction_guards():
    with pytest.raises(builder.SourcesError, match="re-extract together"):
        run([row(1)], extracted="2026-09-29T00:00:00.000+00:00")
    with pytest.raises(builder.SourcesError, match="different extraction"):
        run([row(1)], leads_extracted="2026-09-29T00:00:00.000+00:00")
    with pytest.raises(builder.SourcesError, match="cutoff"):
        run([row(1)], cutoff="2026-09-29")
    run([row(1)], extracted="2026-09-30T20:00:00.000+00:00")


def test_invalid_slug_and_out_of_range_dates_abort():
    with pytest.raises(builder.SourcesError, match="valid slug"):
        run([row(1, credited="Bad Slug!")])
    with pytest.raises(builder.SourcesError, match="outside"):
        run([row(1, day="2026-10-02")])


def test_cost_per_rental_is_at_least_and_needs_mapping_and_credited_rentals():
    meta = {"periods": {"2026-09": {"campaigns": [{"campaignId": "111", "spend": 300.0}, {"campaignId": "999", "spend": 50.0}]}}}
    google = {"campaigns": [{"month": "2026-09", "id": "555", "costMicros": 100_000_000}, {"month": "2026-08", "id": "555", "costMicros": 9_000_000}]}
    rows = [row(1, "c1", credited="paid_one"), row(2, "c2", online=True, online_slug="paid_one"), row(3, "c3")]
    mapped = {**mapping_for("paid_one", meta=["111"], google=["555"]), **mapping_for("unused", meta=["999"])}
    cost = run(rows, mapping=mapped, meta=meta, google=google)["periods"][0]["cost"]
    assert cost == [{"slug": "paid_one", "creditedRentals": 2, "spend": 400.0, "costPerRentalAtLeast": 200.0}]
    assert run(rows, meta=meta, google=google)["periods"][0]["cost"] == []


def test_mapping_file_validation():
    assert builder.read_mapping(None) == {}
    with pytest.raises(builder.SourcesError):
        builder.read_mapping({"schema": "nope"})
    with pytest.raises(builder.SourcesError, match="twice"):
        builder.read_mapping({"schema": builder.MAPPING_SCHEMA, "campaigns": [{"slug": "a"}, {"slug": "a"}]})
    with pytest.raises(builder.SourcesError, match="non-numeric"):
        builder.read_mapping({"schema": builder.MAPPING_SCHEMA, "campaigns": [{"slug": "a", "meta": ["x"]}]})
    shipped = json.loads((ROOT / "data" / "sources-mapping.json").read_text(encoding="utf-8"))
    assert builder.read_mapping(shipped) == {}
