from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
TOOL_PATH = ROOT / "scripts/work-lineage/apply_global_work_lineage_delta_v01.py"
SPEC = importlib.util.spec_from_file_location("work_lineage_delta_writer", TOOL_PATH)
assert SPEC is not None and SPEC.loader is not None
tool = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = tool
SPEC.loader.exec_module(tool)


class DeltaWriterTests(unittest.TestCase):
    release_ref = "release/global-work-lineage-v01/2026-08-20.1"

    def document(self, work_id: str = "42", title: str = "新标题") -> dict:
        return {
            "contractVersion": "global-work-lineage-v01",
            "workId": work_id,
            "canonical": {"naming": {"canonicalTitle": title}},
            "identities": {},
            "research": {},
            "assessment": {},
            "candidate": {},
            "published": {},
            "human": {},
            "reservations": {},
            "quarantine": {},
            "effectiveState": {},
            "integrity": {},
            "provenance": {"auditRunRef": "audit-run-v01:test"},
        }

    def row(self, work_id: str = "42", base: str = "a" * 64, title: str = "新标题") -> dict:
        return {
            "schemaVersion": "global-work-lineage-delta-row-v01",
            "workId": work_id,
            "baseDocumentSha256": base,
            "document": self.document(work_id, title),
        }

    def write_delta(self, root: Path, rows: list[dict] | None = None, *, canonical: bool = True) -> Path:
        path = root / "delta.jsonl"
        values = rows or [self.row()]
        if canonical:
            payload = b"".join(tool.canonical_json(value) + b"\n" for value in values)
        else:
            payload = b"".join((json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8") for value in values)
        path.write_bytes(payload)
        return path

    def gate_document(self, delta) -> dict:
        return {
            "schemaVersion": "global-work-lineage-delta-apply-gate-v01",
            "applyEnabled": True,
            "releaseRef": self.release_ref,
            "deltaSha256": delta.raw_sha256,
            "baseSetSha256": delta.base_set_sha256,
            "rowCount": len(delta.rows),
        }

    def write_gate(self, root: Path, value: dict) -> Path:
        path = root / "gate.json"
        path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        return path

    def test_canonical_json_matches_fresh_importer_definition(self) -> None:
        value = {"z": "百合", "a": [3, {"b": True}]}
        self.assertEqual(tool.canonical_json(value), b'{"a":[3,{"b":true}],"z":"\xe7\x99\xbe\xe5\x90\x88"}')
        self.assertEqual(tool.sha256_bytes(tool.canonical_json(value)), "1d28f085b5095004ccb2659b4763601577599a708c60f71b9d3e7ae07c3ef374")

    def test_offline_default_generates_deterministic_sql_and_receipt_without_psql(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            delta_path = self.write_delta(root)
            with mock.patch.object(tool.subprocess, "run") as run_process:
                receipt1 = tool.run(delta_path=delta_path, release_ref=self.release_ref, out_dir=root / "out-1")
                receipt2 = tool.run(delta_path=delta_path, release_ref=self.release_ref, out_dir=root / "out-2")
            run_process.assert_not_called()
            self.assertEqual((root / "out-1/apply.sql").read_bytes(), (root / "out-2/apply.sql").read_bytes())
            self.assertEqual((root / "out-1/receipt.json").read_bytes(), (root / "out-2/receipt.json").read_bytes())
            self.assertEqual(receipt1, receipt2)
            self.assertEqual(receipt1["status"], "PASS_OFFLINE_VALIDATED")
            self.assertFalse(receipt1["execution"]["databaseWrite"])

    def test_rejects_noncanonical_jsonl(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            path = self.write_delta(root, canonical=False)
            with self.assertRaisesRegex(tool.DeltaError, "not canonical"):
                tool.load_delta(path)

    def test_rejects_retired_legacy_or_any_top_level_shape_drift(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            row = self.row()
            row["document"]["legacy"] = {}
            path = self.write_delta(root, [row])
            with self.assertRaisesRegex(tool.DeltaError, "top-level shape drift"):
                tool.load_delta(path)

    def test_sql_locks_each_target_and_has_only_cas_update_write_scope(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            path = self.write_delta(root, [self.row("2", "a" * 64), self.row("11", "b" * 64)])
            delta = tool.load_delta(path)
            sql = tool.render_sql(delta, self.release_ref).decode("utf-8")
            tool.assert_update_only_sql(sql)
            self.assertIn("FOR UPDATE OF w", sql)
            self.assertIn("document_sha256 = staged.base_document_sha256", sql)
            self.assertIn("target work_id does not exist", sql)
            scrubbed = tool._strip_single_quoted_literals(sql).upper()
            for forbidden in tool.FORBIDDEN_SQL_TOKENS:
                self.assertNotRegex(scrubbed, rf"\b{forbidden}\b")

    def test_apply_is_fail_closed_on_gate_and_confirmation_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            path = self.write_delta(root)
            delta = tool.load_delta(path)
            with mock.patch.object(tool.subprocess, "run") as run_process:
                disabled = self.gate_document(delta)
                disabled["applyEnabled"] = False
                gate_path = self.write_gate(root, disabled)
                with self.assertRaisesRegex(tool.DeltaError, "applyEnabled"):
                    tool.run(
                        delta_path=path,
                        release_ref=self.release_ref,
                        out_dir=root / "disabled",
                        gate_path=gate_path,
                        apply=True,
                        database_url="postgresql://localhost/test",
                        confirm_release_ref=self.release_ref,
                    )

                mismatches = {
                    "releaseRef": "different-release",
                    "deltaSha256": "b" * 64,
                    "baseSetSha256": "c" * 64,
                    "rowCount": 2,
                }
                for field, wrong_value in mismatches.items():
                    with self.subTest(field=field):
                        mismatched = self.gate_document(delta)
                        mismatched[field] = wrong_value
                        gate_path = self.write_gate(root, mismatched)
                        with self.assertRaisesRegex(tool.DeltaError, field):
                            tool.run(
                                delta_path=path,
                                release_ref=self.release_ref,
                                out_dir=root / f"mismatch-{field}",
                                gate_path=gate_path,
                                apply=True,
                                database_url="postgresql://localhost/test",
                                confirm_release_ref=self.release_ref,
                            )

                enabled = self.gate_document(delta)
                gate_path = self.write_gate(root, enabled)
                with self.assertRaisesRegex(tool.DeltaError, "confirm-release-ref"):
                    tool.run(
                        delta_path=path,
                        release_ref=self.release_ref,
                        out_dir=root / "wrong-confirmation",
                        gate_path=gate_path,
                        apply=True,
                        database_url="postgresql://localhost/test",
                        confirm_release_ref="different-release",
                    )
            run_process.assert_not_called()

    def test_exact_gate_apply_uses_psql_and_writes_applied_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            path = self.write_delta(root)
            delta = tool.load_delta(path)
            gate_path = self.write_gate(root, self.gate_document(delta))
            completed = subprocess.CompletedProcess([], 0, stdout=b"", stderr=b"")
            with mock.patch.object(tool.shutil, "which", return_value="/usr/bin/psql"), mock.patch.object(
                tool.subprocess, "run", return_value=completed
            ) as run_process:
                receipt = tool.run(
                    delta_path=path,
                    release_ref=self.release_ref,
                    out_dir=root / "applied",
                    gate_path=gate_path,
                    apply=True,
                    database_url="postgresql://localhost/test",
                    confirm_release_ref=self.release_ref,
                )
            command = run_process.call_args.args[0]
            self.assertEqual(command[0], "/usr/bin/psql")
            self.assertIn("--no-psqlrc", command)
            self.assertEqual(receipt["status"], "PASS_APPLIED")
            self.assertTrue(receipt["execution"]["databaseWrite"])
            self.assertTrue(receipt["gate"]["exactBindingVerified"])


if __name__ == "__main__":
    unittest.main()
