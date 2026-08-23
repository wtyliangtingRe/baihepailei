#!/usr/bin/env python3
"""Validate and optionally insert new WorkLineage rows and immutable provenance.

The default mode is offline.  Apply is fail-closed behind one exact disabled-by-
default gate.  SQL contains INSERT only: existing object refs, document hashes,
or work IDs abort the whole transaction.  There is no update, delete, merge,
upsert, retry, Work-ID allocation, or compatibility path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import unquote, urlparse


CONTRACT_VERSION = "global-work-lineage-v01"
PACKAGE_VERSION = "global-work-lineage-provision-package-v01"
GATE_VERSION = "global-work-lineage-provision-apply-gate-v01"
RECEIPT_VERSION = "global-work-lineage-provision-receipt-v01"
FROZEN_BLOCK_COUNT = 13
ACTIVE_BLOCKS = (
    "canonical",
    "identities",
    "research",
    "assessment",
    "candidate",
    "published",
    "human",
    "reservations",
    "quarantine",
    "effectiveState",
    "integrity",
    "provenance",
)
DOCUMENT_TOP_LEVEL = frozenset(ACTIVE_BLOCKS) | {"contractVersion", "workId"}
PACKAGE_FIELDS = {
    "schemaVersion",
    "existingProvenanceRefs",
    "provenanceObjects",
    "works",
}
PROVENANCE_ROW_FIELDS = {"objectRef", "objectKind", "document"}
WORK_ROW_FIELDS = {"workId", "document"}
GATE_FIELDS = {
    "schemaVersion",
    "applyEnabled",
    "releaseRef",
    "packageSha256",
    "provenanceSetSha256",
    "workSetSha256",
    "provenanceObjectCount",
    "workCount",
}
OBJECT_KINDS = {
    "observation",
    "audit_run",
    "output_manifest",
    "provenance_bundle",
    "formal_package_manifest",
}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
FORBIDDEN_SQL_TOKENS = {
    "ALTER",
    "COPY",
    "CREATE",
    "DELETE",
    "DROP",
    "MERGE",
    "TRUNCATE",
    "UPDATE",
    "UPSERT",
}


class ProvisionError(ValueError):
    """A deterministic validation or authorization failure."""


@dataclass(frozen=True)
class ProvenanceObject:
    object_ref: str
    object_kind: str
    document_sha256: str
    document: dict[str, Any]


@dataclass(frozen=True)
class WorkRow:
    work_id: str
    document_sha256: str
    audit_run_ref: str
    document: dict[str, Any]


@dataclass(frozen=True)
class ProvisionPackage:
    path: Path
    raw_sha256: str
    provenance_set_sha256: str
    work_set_sha256: str
    existing_provenance_refs: tuple[str, ...]
    provenance_objects: tuple[ProvenanceObject, ...]
    works: tuple[WorkRow, ...]


@dataclass(frozen=True)
class Gate:
    path: Path
    file_sha256: str
    document: dict[str, Any]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProvisionError(message)


def canonical_json(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ProvisionError(f"value is not canonical JSON: {exc}") from exc


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and SHA256_RE.fullmatch(value) is not None


def validate_text(value: Any, label: str, *, maximum: int = 512) -> str:
    require(isinstance(value, str), f"{label} must be a string")
    require(value != "" and value == value.strip(), f"{label} must be nonblank and unpadded")
    require(len(value) <= maximum, f"{label} is too long")
    require(
        not any(ord(char) < 0x20 or ord(char) == 0x7F for char in value),
        f"{label} contains a control byte",
    )
    return value


def validate_release_ref(value: Any) -> str:
    return validate_text(value, "releaseRef", maximum=256)


def _nested_text(document: dict[str, Any], path: Sequence[str]) -> str | None:
    value: Any = document
    for key in path:
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value if isinstance(value, str) else None


def validate_document(document: Any, work_id: str, *, ordinal: int) -> tuple[dict[str, Any], str]:
    label = f"work row {ordinal} ({work_id})"
    require(isinstance(document, dict), f"{label}: document must be an object")
    require(set(document) == DOCUMENT_TOP_LEVEL, f"{label}: document top-level shape drift")
    require("legacy" not in document, f"{label}: retired legacy block is forbidden")
    require(document.get("contractVersion") == CONTRACT_VERSION, f"{label}: contractVersion drift")
    require(document.get("workId") == work_id, f"{label}: document/workId mismatch")
    for block in ACTIVE_BLOCKS:
        require(isinstance(document[block], dict), f"{label}: block {block} must be an object")
    title = _nested_text(document, ("canonical", "naming", "canonicalTitle"))
    require(title is not None and title.strip() != "", f"{label}: canonical title is missing")
    audit_ref = _nested_text(document, ("provenance", "auditRunRef"))
    require(audit_ref is not None and audit_ref.strip() != "", f"{label}: auditRunRef is missing")
    validate_text(audit_ref, f"{label}: auditRunRef")
    return document, audit_ref


def _expect_list(value: Any, label: str) -> list[Any]:
    require(isinstance(value, list), f"{label} must be an array")
    return value


def load_package(path: Path) -> ProvisionPackage:
    require(path.is_file(), f"provision package is missing: {path}")
    payload = path.read_bytes()
    require(payload != b"", "provision package is empty")
    require(payload.endswith(b"\n"), "provision package must end with LF")
    require(b"\r" not in payload, "provision package contains a CR byte")
    try:
        value = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProvisionError(f"invalid provision package JSON: {exc}") from exc
    require(isinstance(value, dict), "provision package must be an object")
    require(canonical_json(value) + b"\n" == payload, "provision package JSON is not canonical")
    require(set(value) == PACKAGE_FIELDS, "provision package root shape drift")
    require(value["schemaVersion"] == PACKAGE_VERSION, "provision package schemaVersion drift")

    existing_raw = _expect_list(value["existingProvenanceRefs"], "existingProvenanceRefs")
    existing_refs = tuple(
        validate_text(item, f"existingProvenanceRefs[{index}]")
        for index, item in enumerate(existing_raw)
    )
    require(len(existing_refs) == len(set(existing_refs)), "duplicate existing provenance ref")
    require(list(existing_refs) == sorted(existing_refs), "existingProvenanceRefs must be sorted")

    objects: list[ProvenanceObject] = []
    object_refs: set[str] = set()
    object_hashes: set[str] = set()
    for index, raw in enumerate(_expect_list(value["provenanceObjects"], "provenanceObjects"), 1):
        require(isinstance(raw, dict), f"provenance object {index} must be an object")
        require(set(raw) == PROVENANCE_ROW_FIELDS, f"provenance object {index} shape drift")
        object_ref = validate_text(raw["objectRef"], f"provenance object {index} objectRef")
        object_kind = validate_text(raw["objectKind"], f"provenance object {index} objectKind")
        require(object_kind in OBJECT_KINDS, f"provenance object {index} kind is invalid")
        require(isinstance(raw["document"], dict), f"provenance object {index} document must be an object")
        digest = sha256_bytes(canonical_json(raw["document"]))
        require(object_ref not in object_refs, f"duplicate provenance objectRef: {object_ref}")
        require(digest not in object_hashes, f"duplicate provenance document SHA-256: {digest}")
        require(object_ref not in existing_refs, f"provenance ref declared both existing and new: {object_ref}")
        object_refs.add(object_ref)
        object_hashes.add(digest)
        objects.append(ProvenanceObject(object_ref, object_kind, digest, raw["document"]))

    works: list[WorkRow] = []
    work_ids: set[str] = set()
    work_hashes: set[str] = set()
    referenced_audit_runs: set[str] = set()
    staged_kinds = {item.object_ref: item.object_kind for item in objects}
    for index, raw in enumerate(_expect_list(value["works"], "works"), 1):
        require(isinstance(raw, dict), f"work row {index} must be an object")
        require(set(raw) == WORK_ROW_FIELDS, f"work row {index} shape drift")
        work_id = validate_text(raw["workId"], f"work row {index} workId", maximum=256)
        require(work_id not in work_ids, f"duplicate workId: {work_id}")
        document, audit_ref = validate_document(raw["document"], work_id, ordinal=index)
        digest = sha256_bytes(canonical_json(document))
        require(digest not in work_hashes, f"duplicate Work document SHA-256: {digest}")
        require(
            audit_ref in object_refs or audit_ref in existing_refs,
            f"work row {index}: auditRunRef is not declared new or existing: {audit_ref}",
        )
        if audit_ref in staged_kinds:
            require(
                staged_kinds[audit_ref] == "audit_run",
                f"work row {index}: staged auditRunRef is not an audit_run object",
            )
        work_ids.add(work_id)
        work_hashes.add(digest)
        referenced_audit_runs.add(audit_ref)
        works.append(WorkRow(work_id, digest, audit_ref, document))

    require(objects or works, "provision package must contain at least one new object or Work")
    unused_existing = sorted(set(existing_refs) - referenced_audit_runs)
    require(not unused_existing, "unused existingProvenanceRefs: " + ", ".join(unused_existing))
    provenance_set = b"".join(
        f"{item.object_ref}\t{item.object_kind}\t{item.document_sha256}\n".encode("utf-8")
        for item in sorted(objects, key=lambda item: item.object_ref)
    )
    work_set = b"".join(
        f"{item.work_id}\t{item.document_sha256}\n".encode("utf-8")
        for item in sorted(works, key=lambda item: (len(item.work_id), item.work_id))
    )
    return ProvisionPackage(
        path=path,
        raw_sha256=sha256_bytes(payload),
        provenance_set_sha256=sha256_bytes(provenance_set),
        work_set_sha256=sha256_bytes(work_set),
        existing_provenance_refs=existing_refs,
        provenance_objects=tuple(objects),
        works=tuple(works),
    )


def load_gate(path: Path) -> Gate:
    require(path.is_file(), f"gate file is missing: {path}")
    payload = path.read_bytes()
    require(b"\r" not in payload, "gate contains a CR byte")
    try:
        value = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProvisionError(f"invalid gate JSON: {exc}") from exc
    require(isinstance(value, dict), "gate must be an object")
    require(set(value) == GATE_FIELDS, "gate root shape drift")
    require(value["schemaVersion"] == GATE_VERSION, "gate schemaVersion drift")
    require(type(value["applyEnabled"]) is bool, "gate applyEnabled must be boolean")
    validate_release_ref(value["releaseRef"])
    for field in ("packageSha256", "provenanceSetSha256", "workSetSha256"):
        require(is_sha256(value[field]), f"gate {field} is invalid")
    for field in ("provenanceObjectCount", "workCount"):
        require(type(value[field]) is int and value[field] >= 0, f"gate {field} is invalid")
    return Gate(path=path, file_sha256=sha256_bytes(payload), document=value)


def validate_gate_binding(gate: Gate, package: ProvisionPackage, release_ref: str) -> None:
    expected = {
        "schemaVersion": GATE_VERSION,
        "applyEnabled": gate.document["applyEnabled"],
        "releaseRef": release_ref,
        "packageSha256": package.raw_sha256,
        "provenanceSetSha256": package.provenance_set_sha256,
        "workSetSha256": package.work_set_sha256,
        "provenanceObjectCount": len(package.provenance_objects),
        "workCount": len(package.works),
    }
    require(gate.document == expected, "gate does not exactly bind the provision package and releaseRef")


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _strip_single_quoted_literals(sql: str) -> str:
    result: list[str] = []
    index = 0
    while index < len(sql):
        if sql[index] != "'":
            result.append(sql[index])
            index += 1
            continue
        result.append("''")
        index += 1
        while index < len(sql):
            if sql[index] == "'":
                if index + 1 < len(sql) and sql[index + 1] == "'":
                    index += 2
                    continue
                index += 1
                break
            index += 1
    return "".join(result)


def assert_insert_only_sql(sql: str, *, has_objects: bool, has_works: bool) -> None:
    scrubbed = _strip_single_quoted_literals(sql)
    scrubbed = re.sub(r"--[^\n]*", "", scrubbed)
    upper = scrubbed.upper()
    tokens = set(re.findall(r"[A-Za-z_]+", upper))
    forbidden = sorted(tokens & FORBIDDEN_SQL_TOKENS)
    require(not forbidden, f"generated SQL contains forbidden write token(s): {', '.join(forbidden)}")
    require("ON CONFLICT" not in upper, "generated SQL contains forbidden ON CONFLICT")
    expected_inserts = int(has_objects) + int(has_works)
    require(upper.count("INSERT INTO GLOBAL_WORK_LINEAGE_V01.") == expected_inserts, "insert scope drift")
    require(
        ("INSERT INTO GLOBAL_WORK_LINEAGE_V01.PROVENANCE_OBJECTS" in upper) == has_objects,
        "provenance-object insert scope drift",
    )
    require(
        ("INSERT INTO GLOBAL_WORK_LINEAGE_V01.WORK_LINEAGES" in upper) == has_works,
        "Work insert scope drift",
    )
    if has_works:
        require(
            "FROM GLOBAL_WORK_LINEAGE_V01.WORK_LINEAGES AS W" in upper
            and "WHERE W.WORK_ID = STAGED.WORK_ID" in upper,
            "SQL lacks existing-work fail-closed check",
        )
        require("FOR KEY SHARE OF P" in upper, "SQL lacks audit-run dependency lock")


def _values(rows: list[tuple[str, ...]]) -> str:
    return ",\n".join(
        "      (" + ", ".join(f"{sql_literal(value)}::text" for value in row) + ")"
        for row in rows
    )


def render_sql(package: ProvisionPackage, release_ref: str) -> bytes:
    sections: list[str] = []
    if package.provenance_objects:
        values = _values(
            [
                (
                    item.object_ref,
                    item.object_kind,
                    item.document_sha256,
                    canonical_json(item.document).decode("utf-8"),
                )
                for item in package.provenance_objects
            ]
        )
        sections.append(
            f"""
  FOR staged IN
    SELECT incoming.*
    FROM (VALUES
{values}
    ) AS incoming(object_ref, object_kind, document_sha256, document_text)
    ORDER BY incoming.object_ref
  LOOP
    IF EXISTS (
      SELECT 1
        FROM global_work_lineage_v01.provenance_objects AS p
       WHERE p.object_ref = staged.object_ref
          OR p.document_sha256 = staged.document_sha256
    ) THEN
      RAISE EXCEPTION 'Global Work Lineage new provenance object already exists: %', staged.object_ref;
    END IF;

    INSERT INTO global_work_lineage_v01.provenance_objects (
      object_ref, object_kind, document_sha256, document
    ) VALUES (
      staged.object_ref,
      staged.object_kind,
      staged.document_sha256,
      staged.document_text::jsonb
    );
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      RAISE EXCEPTION 'Global Work Lineage provenance insert count drift for object_ref %: %',
        staged.object_ref, changed_rows;
    END IF;
  END LOOP;
"""
        )
    if package.works:
        values = _values(
            [
                (
                    item.work_id,
                    item.document_sha256,
                    item.audit_run_ref,
                    canonical_json(item.document).decode("utf-8"),
                )
                for item in package.works
            ]
        )
        sections.append(
            f"""
  FOR staged IN
    SELECT incoming.*
    FROM (VALUES
{values}
    ) AS incoming(work_id, document_sha256, audit_run_ref, document_text)
    ORDER BY length(incoming.work_id), incoming.work_id
  LOOP
    IF EXISTS (
      SELECT 1
        FROM global_work_lineage_v01.work_lineages AS w
       WHERE w.work_id = staged.work_id
          OR w.document_sha256 = staged.document_sha256
    ) THEN
      RAISE EXCEPTION 'Global Work Lineage new work_id already exists: %', staged.work_id;
    END IF;

    PERFORM 1
     FROM global_work_lineage_v01.provenance_objects AS p
     WHERE p.object_ref = staged.audit_run_ref
       AND p.object_kind = 'audit_run'
       FOR KEY SHARE OF p;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Global Work Lineage auditRunRef does not exist for new work_id %: %',
        staged.work_id, staged.audit_run_ref;
    END IF;

    INSERT INTO global_work_lineage_v01.work_lineages (
      work_id, document_sha256, document
    ) VALUES (
      staged.work_id,
      staged.document_sha256,
      staged.document_text::jsonb
    );
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      RAISE EXCEPTION 'Global Work Lineage Work insert count drift for work_id %: %',
        staged.work_id, changed_rows;
    END IF;
  END LOOP;
"""
        )
    sql = f"""\\set ON_ERROR_STOP on
-- Global Work Lineage v01 insert-only provision package.
-- releaseRef: {release_ref}
-- packageSha256: {package.raw_sha256}
-- provenanceSetSha256: {package.provenance_set_sha256}
-- workSetSha256: {package.work_set_sha256}
-- provenanceObjectCount: {len(package.provenance_objects)}
-- workCount: {len(package.works)}
BEGIN;
SET LOCAL standard_conforming_strings = on;

DO $global_work_lineage_provision_v01$
DECLARE
  staged record;
  changed_rows integer;
BEGIN
{"".join(sections)}
END
$global_work_lineage_provision_v01$;

COMMIT;
"""
    assert_insert_only_sql(
        sql,
        has_objects=bool(package.provenance_objects),
        has_works=bool(package.works),
    )
    return sql.encode("utf-8")


def validate_database_url(database_url: str) -> None:
    parsed = urlparse(database_url)
    require(parsed.scheme in {"postgres", "postgresql"}, "database URL must use postgres or postgresql")
    require(parsed.hostname is not None, "database URL must name a host")
    database_name = unquote(parsed.path.lstrip("/"))
    require(database_name != "" and "/" not in database_name, "database URL must name exactly one database")


def execute_sql(database_url: str, sql_path: Path, psql_bin: str) -> None:
    validate_database_url(database_url)
    executable = shutil.which(psql_bin)
    require(executable is not None, f"psql executable is unavailable: {psql_bin}")
    env = os.environ.copy()
    env["PGOPTIONS"] = "-c default_transaction_read_only=off"
    env["PGAPPNAME"] = "baihepailei-global-work-lineage-provision-v01"
    process = subprocess.run(
        [
            executable,
            "--no-psqlrc",
            "--set",
            "ON_ERROR_STOP=1",
            "--dbname",
            database_url,
            "--file",
            sql_path.name,
        ],
        cwd=sql_path.parent,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if process.returncode != 0:
        details = (process.stdout + process.stderr).decode("utf-8", errors="replace")
        raise ProvisionError(f"psql insert-only provision failed:\n{details}")


def build_receipt(
    *,
    package: ProvisionPackage,
    release_ref: str,
    sql_sha256: str,
    gate: Gate | None,
    applied: bool,
) -> dict[str, Any]:
    target_tables: list[str] = []
    operations: list[str] = []
    if package.provenance_objects:
        target_tables.append("global_work_lineage_v01.provenance_objects")
        operations.append("IMMUTABLE_PROVENANCE")
    if package.works:
        target_tables.append("global_work_lineage_v01.work_lineages")
        operations.append("NEW_WORK_ID")
    return {
        "schemaVersion": RECEIPT_VERSION,
        "status": "PASS_APPLIED" if applied else "PASS_OFFLINE_VALIDATED",
        "contractVersion": CONTRACT_VERSION,
        "frozenBlockCount": FROZEN_BLOCK_COUNT,
        "activeTopLevelBlocks": list(ACTIVE_BLOCKS),
        "releaseRef": release_ref,
        "package": {
            "path": package.path.name,
            "rawSha256": package.raw_sha256,
            "provenanceSetSha256": package.provenance_set_sha256,
            "workSetSha256": package.work_set_sha256,
            "existingProvenanceRefCount": len(package.existing_provenance_refs),
            "newProvenanceObjectCount": len(package.provenance_objects),
            "newWorkCount": len(package.works),
        },
        "gate": None
        if gate is None
        else {
            "path": gate.path.name,
            "schemaVersion": gate.document["schemaVersion"],
            "fileSha256": gate.file_sha256,
            "applyEnabled": gate.document["applyEnabled"],
            "exactBindingVerified": True,
        },
        "output": {"sql": {"path": "apply.sql", "sha256": sql_sha256}},
        "execution": {
            "databaseWrite": applied,
            "operation": "INSERT_" + "_AND_".join(operations) + "_ONLY",
            "targetTables": target_tables,
            "existingWorkIdPrecondition": "must_be_absent",
            "existingObjectRefPrecondition": "must_be_absent",
            "concurrentConflict": "unique_constraint_aborts_transaction",
            "insertWorkRows": len(package.works) if applied else 0,
            "insertProvenanceObjects": len(package.provenance_objects) if applied else 0,
            "updateRows": 0,
            "deleteRows": 0,
            "upsertRows": 0,
            "automaticRetry": False,
            "compatibilityLayer": False,
        },
    }


def run(
    *,
    package_path: Path,
    release_ref: str,
    out_dir: Path,
    gate_path: Path | None = None,
    apply: bool = False,
    database_url: str | None = None,
    confirm_release_ref: str | None = None,
    confirm_package_sha256: str | None = None,
    psql_bin: str = "psql",
) -> dict[str, Any]:
    release_ref = validate_release_ref(release_ref)
    require(not out_dir.exists(), f"output path already exists: {out_dir}")
    package = load_package(package_path)
    gate = load_gate(gate_path) if gate_path is not None else None
    if gate is not None:
        validate_gate_binding(gate, package, release_ref)
    if apply:
        require(gate is not None, "--gate is required with --apply")
        require(gate.document["applyEnabled"] is True, "gate applyEnabled is not true")
        require(database_url is not None and database_url != "", "--database-url is required with --apply")
        require(confirm_release_ref == release_ref, "--confirm-release-ref does not exactly match --release-ref")
        require(
            confirm_package_sha256 == package.raw_sha256,
            "--confirm-package-sha256 does not exactly match package bytes",
        )
    else:
        require(database_url is None, "--database-url is only accepted with --apply")
        require(confirm_release_ref is None, "--confirm-release-ref is only accepted with --apply")
        require(confirm_package_sha256 is None, "--confirm-package-sha256 is only accepted with --apply")

    sql = render_sql(package, release_ref)
    out_dir.mkdir(parents=True)
    sql_path = out_dir / "apply.sql"
    sql_path.write_bytes(sql)
    if apply:
        execute_sql(str(database_url), sql_path, psql_bin)
    receipt = build_receipt(
        package=package,
        release_ref=release_ref,
        sql_sha256=sha256_bytes(sql),
        gate=gate,
        applied=apply,
    )
    receipt_bytes = (
        json.dumps(receipt, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    ).encode("utf-8")
    (out_dir / "receipt.json").write_bytes(receipt_bytes)
    return receipt


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, required=True, help="canonical provision package JSON")
    parser.add_argument("--release-ref", required=True, help="immutable/versioned Published release reference")
    parser.add_argument("--out-dir", type=Path, required=True, help="new directory for apply.sql and receipt.json")
    parser.add_argument("--gate", type=Path, help="versioned exact-binding provision gate")
    parser.add_argument("--apply", action="store_true", help="execute insert-only SQL through psql")
    parser.add_argument("--database-url", help="explicit postgres/postgresql URL; accepted only with --apply")
    parser.add_argument("--confirm-release-ref", help="must exactly repeat --release-ref when applying")
    parser.add_argument("--confirm-package-sha256", help="must exactly repeat the raw package SHA-256")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        receipt = run(
            package_path=args.package.resolve(),
            release_ref=args.release_ref,
            out_dir=args.out_dir.resolve(),
            gate_path=args.gate.resolve() if args.gate else None,
            apply=args.apply,
            database_url=args.database_url,
            confirm_release_ref=args.confirm_release_ref,
            confirm_package_sha256=args.confirm_package_sha256,
        )
    except (ProvisionError, OSError) as exc:
        print(f"GLOBAL WORK LINEAGE PROVISION: FAIL: {exc}", file=sys.stderr)
        return 2
    sys.stdout.buffer.write(
        (json.dumps(receipt, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
