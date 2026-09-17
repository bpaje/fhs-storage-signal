from __future__ import annotations

import contextlib
import copy
import importlib.util
import io
import json
import subprocess
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"


def load_script(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


builder = load_script("build_tenants", ROOT / "scripts" / "build-tenants.py")
guard = load_script("restricted_data_guard", ROOT / "scripts" / "restricted_data_guard.py")


def mutated_builder(fixed: str, reverted: str):
    path = ROOT / "scripts" / "build-tenants.py"
    source = path.read_text(encoding="utf-8")
    if source.count(fixed) != 1:
        raise AssertionError("Expected builder fix text exactly once for mutation check")
    module = ModuleType("build_tenants_mutant")
    module.__file__ = str(path)
    exec(compile(source.replace(fixed, reverted), str(path), "exec"), module.__dict__)
    return module


def fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def output_keys(value):
    if isinstance(value, dict):
        for key, child in value.items():
            yield key
            yield from output_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from output_keys(child)


class TenantBuilderTests(unittest.TestCase):
    def scratch_file(self, name: str, content: str) -> Path:
        path = ROOT / "tests" / name
        path.write_text(content, encoding="utf-8")
        self.addCleanup(path.unlink, missing_ok=True)
        return path

    def build(self):
        return builder.build_artifacts(fixture("tenants-source.json"), fixture("tenants-reporting.json"))

    def test_name_cleaning_and_forbidden_keys(self):
        artifacts = self.build()
        north = artifacts["tenants-100.json"]["profiles"]
        south = artifacts["tenants-200.json"]["profiles"]
        self.assertEqual(north["customer-1"]["name"], "Avery Example")
        self.assertEqual(south["customer-3"]["name"], "Name withheld")
        self.assertTrue(builder.FORBIDDEN_KEYS.isdisjoint({key.lower() for key in output_keys(artifacts)}))

    def test_string_amenities_are_split(self):
        profile = self.build()["tenants-100.json"]["profiles"]["customer-1"]
        self.assertEqual(profile["leases"][0]["unitType"]["amenities"], ["Drive up", "Gated"])

        mutant = mutated_builder(
            '[part.strip() for part in str((unit_type or {}).get("amenities") or "").split(",") if part.strip()]',
            '(unit_type or {}).get("amenities") or []',
        )
        mutant_profile = mutant.build_artifacts(fixture("tenants-source.json"), fixture("tenants-reporting.json"))["tenants-100.json"]["profiles"]["customer-1"]
        self.assertNotEqual(mutant_profile["leases"][0]["unitType"]["amenities"], ["Drive up", "Gated"])
        print("mutation check killed: string amenities passthrough")

    def test_null_returned_amount_is_preserved(self):
        profile = self.build()["tenants-100.json"]["profiles"]["customer-1"]
        lease = next(item for item in profile["leases"] if item["lease_number"] == "L-FIX-001")
        self.assertIsNone(lease["deposits"][0]["returned_amount"])

        mutant = mutated_builder(
            'None if row.get("returned_amount") is None else money(row.get("returned_amount"), "securityDeposits.returned_amount")',
            'money(row.get("returned_amount"), "securityDeposits.returned_amount")',
        )
        with self.assertRaisesRegex(ValueError, "returned_amount must be a decimal string"):
            mutant.build_artifacts(fixture("tenants-source.json"), fixture("tenants-reporting.json"))
        print("mutation check killed: required returned deposit amount")

    def test_blank_alternate_contact_is_null(self):
        profile = self.build()["tenants-100.json"]["profiles"]["customer-1"]
        self.assertIsNone(profile["alternate_contact_name"])

        mutant = mutated_builder(
            'clean_name(customer.get("alternate_contact_name")) if " ".join(str(customer.get("alternate_contact_name") or "").split()) else None',
            'clean_name(customer.get("alternate_contact_name"))',
        )
        mutant_profile = mutant.build_artifacts(fixture("tenants-source.json"), fixture("tenants-reporting.json"))["tenants-100.json"]["profiles"]["customer-1"]
        self.assertEqual(mutant_profile["alternate_contact_name"], "Name withheld")
        print("mutation check killed: blank alternate contact fallback")

    def test_render_fixture_matches_real_builder_output(self):
        artifacts = self.build()
        rendered = fixture("tenants-built-profiles.json")
        self.assertEqual(rendered["north"], artifacts["tenants-100.json"])
        self.assertEqual(rendered["south"], artifacts["tenants-200.json"])

    def test_past_due_status_and_move_in_invoice_null(self):
        index = self.build()["tenants-index.json"]
        past_due = {row["customer_id"]: row for row in index["pastDue"]}
        self.assertEqual(past_due["customer-2"]["tenantStatus"], "Moved out")
        self.assertEqual(past_due["customer-2"]["days_late"], 31)
        self.assertEqual(past_due["customer-3"]["tenantStatus"], "Current")
        move_in = next(row for row in index["moveIns"] if row["customer_id"] == "customer-1")
        self.assertIsNone(move_in["moveInInvoice"])

    def test_contact_details_in_address_fields_are_withheld(self):
        source = fixture("tenants-source.json")
        customer = next(row for row in source["customers"] if row["id"] == "customer-1")
        customer["address2"] = "Call 555-123-4567 after 5"
        customer["address"] = "box@example.invalid"
        profile = builder.build_artifacts(source, fixture("tenants-reporting.json"))["tenants-100.json"]["profiles"]["customer-1"]
        self.assertEqual(profile["address2"], builder.CONTACT_WITHHELD)
        self.assertEqual(profile["address"], builder.CONTACT_WITHHELD)

        mutant = mutated_builder('"address2": clean_address(customer.get("address2")),', '"address2": customer.get("address2"),')
        mutant_profile = mutant.build_artifacts(source, fixture("tenants-reporting.json"))["tenants-100.json"]["profiles"]["customer-1"]
        self.assertIn("555-123-4567", mutant_profile["address2"])
        print("mutation check killed: phone number in address2")

    def test_balances_use_extraction_date_not_activity_cutoff(self):
        source = fixture("tenants-source.json")
        as_of = source["extractedAt"][:10]
        index = builder.build_artifacts(source, fixture("tenants-reporting.json"))["tenants-index.json"]
        self.assertEqual(index["balancesAsOf"], as_of)
        self.assertLess(index["cutoff"], as_of)
        for row in index["pastDue"]:
            self.assertLess(row["date"], as_of)
            self.assertEqual(row["days_late"], (builder.date.fromisoformat(as_of) - builder.date.fromisoformat(row["date"])).days)

        mutant = mutated_builder('"days_late": (as_of - due).days,', '"days_late": (cutoff - due).days,')
        mutant_index = mutant.build_artifacts(source, fixture("tenants-reporting.json"))["tenants-index.json"]
        self.assertNotEqual([row["days_late"] for row in mutant_index["pastDue"]], [row["days_late"] for row in index["pastDue"]])
        print("mutation check killed: days late measured from activity cutoff")

    def test_extracted_at_mismatch_aborts_without_writing(self):
        source = fixture("tenants-source.json")
        source["extractedAt"] = "2026-09-10T09:00:00+00:00"
        source_path = self.scratch_file(".tenant-source-mismatch.json", json.dumps(source))
        reporting_path = self.scratch_file(".tenant-reporting-mismatch.json", json.dumps(fixture("tenants-reporting.json")))
        with contextlib.redirect_stderr(io.StringIO()) as error:
            result = builder.main([str(source_path), str(reporting_path), "--output-dir", str(ROOT / "tests")])
        self.assertEqual(result, 1)
        self.assertIn("extractedAt mismatch", error.getvalue())
        self.assertFalse((ROOT / "tests" / "tenants-index.json").exists())

    def test_reconciliation_mutation_aborts_without_writing(self):
        reporting = fixture("tenants-reporting.json")
        reporting["periods"][0]["facilities"][0]["moveIns"] += 1
        source_path = self.scratch_file(".tenant-source-reconcile.json", json.dumps(fixture("tenants-source.json")))
        reporting_path = self.scratch_file(".tenant-reporting-reconcile.json", json.dumps(reporting))
        sentinel = self.scratch_file("tenants-index.json", "last-good-output\n")
        before = sentinel.read_bytes()
        with contextlib.redirect_stderr(io.StringIO()) as error:
            result = builder.main([str(source_path), str(reporting_path), "--output-dir", str(ROOT / "tests")])
        self.assertEqual(result, 1)
        self.assertIn("2026-08 facility 100 moveIns", error.getvalue())
        self.assertEqual(sentinel.read_bytes(), before)

    def test_git_guard_and_refresh_exclusion(self):
        for path in ("data/restricted/tenants-index.json", "private-scripts/ccstorage-tenants-source.json"):
            result = subprocess.run(["git", "check-ignore", "-q", path], cwd=ROOT, check=False)
            self.assertEqual(result.returncode, 0, path)
        guard.assert_restricted_data_untracked(ROOT)

        def fake_runner(*_args, **_kwargs):
            return SimpleNamespace(stdout="data/restricted/tenants-index.json\n")

        with self.assertRaisesRegex(AssertionError, "must never be tracked"):
            guard.assert_restricted_data_untracked(ROOT, runner=fake_runner)
        refresh = (ROOT / "private-scripts" / "refresh-dashboard.ps1").read_text(encoding="utf-8")
        self.assertIn("git ls-files -- data/restricted", refresh)
        self.assertIn("':(exclude)data/restricted'", refresh)


if __name__ == "__main__":
    unittest.main()
