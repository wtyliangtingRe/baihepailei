#!/usr/bin/env python3
"""Build a deterministic insert-only provision package and ephemeral test gate."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import build_fixture as base


PACKAGE_VERSION = "global-work-lineage-provision-package-v01"
GATE_VERSION = "global-work-lineage-provision-apply-gate-v01"
NEW_AUDIT_RUN_ID = "global-audit-run-v01:test-provision-writer"


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def write_pretty_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    )


def build(release_ref: str) -> tuple[dict[str, Any], dict[str, Any]]:
    canonical_observation = base.observation(
        "sealed_snapshot_canonical_workid_title_projection", 2, "1" * 64
    )
    identity_observation = base.observation(
        "sealed_snapshot_exact_tuple_projection", 1, "2" * 64
    )
    new_audit_run = {
        "schemaVersion": "global-audit-run-v01",
        "auditRunId": NEW_AUDIT_RUN_ID,
        "state": "sealed",
        "fixturePurpose": "insert-only provision integration",
    }
    new_audit_work = base.make_row(
        "102",
        "Fixture Provisioned New Audit Work",
        canonical_observation["observationId"],
        identity_observation["observationId"],
        False,
    )
    new_audit_work["provenance"]["auditRunRef"] = NEW_AUDIT_RUN_ID
    existing_audit_work = base.make_row(
        "103",
        "Fixture Provisioned Existing Audit Work",
        canonical_observation["observationId"],
        identity_observation["observationId"],
        False,
    )
    package = {
        "schemaVersion": PACKAGE_VERSION,
        "existingProvenanceRefs": [base.AUDIT_RUN_ID],
        "provenanceObjects": [
            {
                "objectRef": NEW_AUDIT_RUN_ID,
                "objectKind": "audit_run",
                "document": new_audit_run,
            }
        ],
        "works": [
            {"workId": "102", "document": new_audit_work},
            {"workId": "103", "document": existing_audit_work},
        ],
    }
    package_payload = canonical_json(package) + b"\n"
    provenance_document_sha = sha256_bytes(canonical_json(new_audit_run))
    provenance_set = (
        f"{NEW_AUDIT_RUN_ID}\taudit_run\t{provenance_document_sha}\n".encode("utf-8")
    )
    work_set = b"".join(
        f"{row['workId']}\t{sha256_bytes(canonical_json(row['document']))}\n".encode("utf-8")
        for row in sorted(package["works"], key=lambda row: (len(row["workId"]), row["workId"]))
    )
    gate = {
        "schemaVersion": GATE_VERSION,
        "applyEnabled": True,
        "releaseRef": release_ref,
        "packageSha256": sha256_bytes(package_payload),
        "provenanceSetSha256": sha256_bytes(provenance_set),
        "workSetSha256": sha256_bytes(work_set),
        "provenanceObjectCount": 1,
        "workCount": 2,
    }
    return package, gate


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--gate", type=Path, required=True)
    parser.add_argument("--release-ref", required=True)
    args = parser.parse_args()
    if args.package.exists() or args.gate.exists():
        raise SystemExit("fixture outputs must not already exist")
    package, gate = build(args.release_ref)
    args.package.parent.mkdir(parents=True, exist_ok=True)
    args.package.write_bytes(canonical_json(package) + b"\n")
    write_pretty_json(args.gate, gate)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
