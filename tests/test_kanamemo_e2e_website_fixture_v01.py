from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "tests/fixtures/kanamemo-e2e-v01/build_fixture.py"
SPEC = importlib.util.spec_from_file_location("kanamemo_e2e_fixture_builder", BUILDER_PATH)
assert SPEC is not None and SPEC.loader is not None
builder = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = builder
SPEC.loader.exec_module(builder)


def write_json(path: Path, value: object) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )


def tree_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


class KanamemoEndToEndWebsiteFixtureTests(unittest.TestCase):
    def test_committed_sources_build_deterministically(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            first = builder.build(root / "first")
            second = builder.build(root / "second")
            self.assertEqual(first, second)
            self.assertEqual(tree_bytes(root / "first"), tree_bytes(root / "second"))
            self.assertEqual("PASS_READY_FOR_DISPOSABLE_POSTGRESQL", first["status"])
            self.assertTrue(first["fixtureApplyAuthorized"])
            self.assertFalse(first["productionWriteAuthorized"])

    def test_delta_is_consumed_by_the_exact_website_writer_contract(self) -> None:
        parsed = builder.DELTA_TOOL.load_delta(builder.DELTA_PATH)
        self.assertEqual(1, len(parsed.rows))
        self.assertEqual(builder.WORK_ID, parsed.rows[0].work_id)
        self.assertEqual(builder.BOOTSTRAP_DOCUMENT_SHA256, parsed.rows[0].base_document_sha256)
        self.assertEqual(builder.FINAL_DOCUMENT_SHA256, parsed.rows[0].new_document_sha256)

    def test_source_binding_cannot_authorize_production(self) -> None:
        binding = builder.load_json(builder.BINDING_PATH)
        binding["website"]["productionWriteAuthorized"] = True
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "binding.json"
            write_json(path, binding)
            with self.assertRaisesRegex(builder.FixtureError, "authorization or base binding drift"):
                builder.validate_fixture(binding_path=path)

    def test_fixed_grade_tamper_fails_closed(self) -> None:
        bootstrap = builder.load_json(builder.BOOTSTRAP_PATH)
        record = builder.load_json(builder.DELTA_PATH)
        final = record["document"]
        final["assessment"]["attempts"][0]["decisions"][0]["conclusion"]["coreGrade"] = "C"
        with self.assertRaisesRegex(builder.FixtureError, "fixed D invariant drift"):
            builder.validate_final_document(final, bootstrap)

    def test_effective_state_is_preserved_fail_closed(self) -> None:
        bootstrap = builder.load_json(builder.BOOTSTRAP_PATH)
        final = builder.load_json(builder.DELTA_PATH)["document"]
        self.assertEqual(bootstrap["effectiveState"], final["effectiveState"])
        self.assertEqual(
            "unknown",
            final["effectiveState"]["ai"]["published"]["occupancyState"],
        )
        self.assertTrue(final["effectiveState"]["ai"]["selection"]["failClosed"])

    def test_old_delta_row_version_is_rejected_by_website_writer(self) -> None:
        record = builder.load_json(builder.DELTA_PATH)
        record["schemaVersion"] = "global-work-lineage-delta-v01"
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "wrong-version.jsonl"
            path.write_bytes(builder.canonical_json(record) + b"\n")
            with self.assertRaisesRegex(
                builder.DELTA_TOOL.DeltaError,
                "schemaVersion drift",
            ):
                builder.DELTA_TOOL.load_delta(path)


if __name__ == "__main__":
    unittest.main()
