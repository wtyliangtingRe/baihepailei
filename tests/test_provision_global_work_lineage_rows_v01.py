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
TOOL_PATH = ROOT / "scripts/work-lineage/provision_global_work_lineage_rows_v01.py"
SPEC = importlib.util.spec_from_file_location("work_lineage_provision_writer", TOOL_PATH)
assert SPEC is not None and SPEC.loader is not None
tool = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = tool
SPEC.loader.exec_module(tool)


class ProvisionWriterTests(unittest.TestCase):
    release_ref = "release/global-work-lineage-v01/new-works/2026-08-22.1"
    audit_ref = "global-audit-run-v01:new-work-test"

    def document(self, work_id: str = "90001", audit_ref: str | None = None) -> dict:
        return {
            "contractVersion": "global-work-lineage-v01",
            "workId": work_id,
            "canonical": {"naming": {"canonicalTitle": f"New Work {work_id}"}},
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
            "provenance": {"auditRunRef": audit_ref or self.audit_ref},
        }

    def package(
        self,
        *,
        works: list[dict] | None = None,
        objects: list[dict] | None = None,
        existing: list[str] | None = None,
    ) -> dict:
        return {
            "schemaVersion": "global-work-lineage-provision-package-v01",
            "existingProvenanceRefs": [] if existing is None else existing,
            "provenanceObjects": (
                [
                    {
                        "objectRef": self.audit_ref,
                        "objectKind": "audit_run",
                        "document": {"auditRunId": self.audit_ref, "status": "accepted"},
                    }
                ]
                if objects is None
                else objects
            ),
            "works": (
                [{"workId": "90001", "document": self.document()}]
                if works is None
                else works
            ),
        }

    def write_package(self, root: Path, value: dict | None = None, *, canonical: bool = True) -> Path:
        path = root / "provision.json"
        value = self.package() if value is None else value
        if canonical:
            payload = tool.canonical_json(value) + b"\n"
        else:
            payload = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        path.write_bytes(payload)
        return path

    def gate_document(self, package, *, enabled: bool = True) -> dict:
        return {
            "schemaVersion": "global-work-lineage-provision-apply-gate-v01",
            "applyEnabled": enabled,
            "releaseRef": self.release_ref,
            "packageSha256": package.raw_sha256,
            "provenanceSetSha256": package.provenance_set_sha256,
            "workSetSha256": package.work_set_sha256,
            "provenanceObjectCount": len(package.provenance_objects),
            "workCount": len(package.works),
        }

    def write_gate(self, root: Path, value: dict) -> Path:
        path = root / "gate.json"
        path.write_text(
            json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        return path

    def test_offline_default_is_deterministic_and_never_calls_psql(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            package_path = self.write_package(root)
            with mock.patch.object(tool.subprocess, "run") as run_process:
                first = tool.run(
                    package_path=package_path,
                    release_ref=self.release_ref,
                    out_dir=root / "out-1",
                )
                second = tool.run(
                    package_path=package_path,
                    release_ref=self.release_ref,
                    out_dir=root / "out-2",
                )
            run_process.assert_not_called()
            self.assertEqual((root / "out-1/apply.sql").read_bytes(), (root / "out-2/apply.sql").read_bytes())
            self.assertEqual((root / "out-1/receipt.json").read_bytes(), (root / "out-2/receipt.json").read_bytes())
            self.assertEqual(first, second)
            self.assertEqual("PASS_OFFLINE_VALIDATED", first["status"])
            self.assertFalse(first["execution"]["databaseWrite"])
            self.assertEqual(0, first["execution"]["insertWorkRows"])

    def test_rejects_noncanonical_or_top_level_shape_drift(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            with self.assertRaisesRegex(tool.ProvisionError, "not canonical"):
                tool.load_package(self.write_package(root, canonical=False))
            value = self.package()
            value["works"][0]["document"]["legacy"] = {}
            with self.assertRaisesRegex(tool.ProvisionError, "top-level shape drift"):
                tool.load_package(self.write_package(root, value))

    def test_audit_dependency_must_be_declared_and_have_audit_run_kind(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            undeclared = self.package(objects=[], existing=[])
            with self.assertRaisesRegex(tool.ProvisionError, "not declared"):
                tool.load_package(self.write_package(root, undeclared))
            wrong_kind = self.package()
            wrong_kind["provenanceObjects"][0]["objectKind"] = "observation"
            with self.assertRaisesRegex(tool.ProvisionError, "not an audit_run"):
                tool.load_package(self.write_package(root, wrong_kind))

    def test_existing_provenance_ref_is_explicit_and_new_work_remains_insert_only(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            value = self.package(objects=[], existing=[self.audit_ref])
            package = tool.load_package(self.write_package(root, value))
            self.assertEqual((self.audit_ref,), package.existing_provenance_refs)
            self.assertEqual(0, len(package.provenance_objects))
            sql = tool.render_sql(package, self.release_ref).decode("utf-8")
            self.assertNotIn("INSERT INTO global_work_lineage_v01.provenance_objects", sql)
            self.assertIn("INSERT INTO global_work_lineage_v01.work_lineages", sql)

    def test_rejects_duplicate_identity_or_document_hashes(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            value = self.package()
            value["works"].append({"workId": "90001", "document": self.document()})
            with self.assertRaisesRegex(tool.ProvisionError, "duplicate workId"):
                tool.load_package(self.write_package(root, value))
            value = self.package()
            second = json.loads(json.dumps(value["provenanceObjects"][0]))
            second["objectRef"] = "global-audit-run-v01:duplicate-document"
            value["provenanceObjects"].append(second)
            with self.assertRaisesRegex(tool.ProvisionError, "duplicate provenance document"):
                tool.load_package(self.write_package(root, value))

    def test_sql_is_insert_only_and_fails_on_existing_work_or_object(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            package = tool.load_package(self.write_package(root))
            sql = tool.render_sql(package, self.release_ref).decode("utf-8")
            tool.assert_insert_only_sql(sql, has_objects=True, has_works=True)
            scrubbed = tool._strip_single_quoted_literals(sql).upper()
            for forbidden in tool.FORBIDDEN_SQL_TOKENS:
                self.assertNotRegex(scrubbed, rf"\b{forbidden}\b")
            self.assertNotIn("ON CONFLICT", scrubbed)
            self.assertIn("new work_id already exists", sql)
            self.assertIn("new provenance object already exists", sql)
            self.assertIn("FOR KEY SHARE OF p", sql)

    def test_provenance_only_package_is_allowed_without_fake_work(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            value = self.package(works=[])
            package = tool.load_package(self.write_package(root, value))
            sql = tool.render_sql(package, self.release_ref).decode("utf-8")
            tool.assert_insert_only_sql(sql, has_objects=True, has_works=False)
            self.assertIn("INSERT INTO global_work_lineage_v01.provenance_objects", sql)
            self.assertNotIn("INSERT INTO global_work_lineage_v01.work_lineages", sql)
            receipt = tool.build_receipt(
                package=package,
                release_ref=self.release_ref,
                sql_sha256=tool.sha256_bytes(sql.encode("utf-8")),
                gate=None,
                applied=False,
            )
            self.assertEqual("INSERT_IMMUTABLE_PROVENANCE_ONLY", receipt["execution"]["operation"])
            self.assertEqual(
                ["global_work_lineage_v01.provenance_objects"],
                receipt["execution"]["targetTables"],
            )

    def test_apply_requires_exact_gate_release_and_package_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            package_path = self.write_package(root)
            package = tool.load_package(package_path)
            disabled = self.write_gate(root, self.gate_document(package, enabled=False))
            with mock.patch.object(tool.subprocess, "run") as run_process:
                with self.assertRaisesRegex(tool.ProvisionError, "applyEnabled"):
                    tool.run(
                        package_path=package_path,
                        release_ref=self.release_ref,
                        out_dir=root / "disabled",
                        gate_path=disabled,
                        apply=True,
                        database_url="postgresql://localhost/test",
                        confirm_release_ref=self.release_ref,
                        confirm_package_sha256=package.raw_sha256,
                    )
                enabled = self.write_gate(root, self.gate_document(package))
                with self.assertRaisesRegex(tool.ProvisionError, "confirm-package-sha256"):
                    tool.run(
                        package_path=package_path,
                        release_ref=self.release_ref,
                        out_dir=root / "wrong-package",
                        gate_path=enabled,
                        apply=True,
                        database_url="postgresql://localhost/test",
                        confirm_release_ref=self.release_ref,
                        confirm_package_sha256="0" * 64,
                    )
                wrong_gate = self.gate_document(package)
                wrong_gate["workCount"] = 2
                gate_path = self.write_gate(root, wrong_gate)
                with self.assertRaisesRegex(tool.ProvisionError, "exactly bind"):
                    tool.run(
                        package_path=package_path,
                        release_ref=self.release_ref,
                        out_dir=root / "wrong-gate",
                        gate_path=gate_path,
                    )
            run_process.assert_not_called()

    def test_exact_apply_invokes_psql_and_records_only_insert_counts(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            package_path = self.write_package(root)
            package = tool.load_package(package_path)
            gate_path = self.write_gate(root, self.gate_document(package))
            completed = subprocess.CompletedProcess([], 0, stdout=b"", stderr=b"")
            with mock.patch.object(tool.shutil, "which", return_value="/usr/bin/psql"), mock.patch.object(
                tool.subprocess, "run", return_value=completed
            ) as run_process:
                receipt = tool.run(
                    package_path=package_path,
                    release_ref=self.release_ref,
                    out_dir=root / "applied",
                    gate_path=gate_path,
                    apply=True,
                    database_url="postgresql://localhost/test",
                    confirm_release_ref=self.release_ref,
                    confirm_package_sha256=package.raw_sha256,
                )
            self.assertEqual("/usr/bin/psql", run_process.call_args.args[0][0])
            self.assertEqual("PASS_APPLIED", receipt["status"])
            self.assertEqual(1, receipt["execution"]["insertWorkRows"])
            self.assertEqual(1, receipt["execution"]["insertProvenanceObjects"])
            self.assertEqual(0, receipt["execution"]["updateRows"])
            self.assertEqual(0, receipt["execution"]["upsertRows"])

    def test_output_directory_is_create_only(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            package_path = self.write_package(root)
            out = root / "out"
            tool.run(package_path=package_path, release_ref=self.release_ref, out_dir=out)
            with self.assertRaisesRegex(tool.ProvisionError, "already exists"):
                tool.run(package_path=package_path, release_ref=self.release_ref, out_dir=out)


if __name__ == "__main__":
    unittest.main()
