#!/usr/bin/env python3
"""Validate and optionally apply an existing-Work Global Work Lineage v01 delta.

The default mode is entirely offline: it validates canonical JSONL input and
writes a reviewable SQL file plus a deterministic receipt. Database execution
is fail-closed behind an exact, versioned release gate.
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
DELTA_ROW_VERSION = "global-work-lineage-delta-row-v01"
GATE_VERSION = "global-work-lineage-delta-apply-gate-v01"
RECEIPT_VERSION = "global-work-lineage-delta-receipt-v01"
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
DELTA_ROW_FIELDS = {"schemaVersion", "workId", "baseDocumentSha256", "document"}
GATE_FIELDS = {
    "schemaVersion",
    "applyEnabled",
    "releaseRef",
    "deltaSha256",
    "baseSetSha256",
    "rowCount",
}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
FORBIDDEN_SQL_TOKENS = {
    "ALTER",
    "COPY",
    "CREATE",
    "DELETE",
    "DROP",
    "INSERT",
    "MERGE",
    "TRUNCATE",
    "UPSERT",
}


class DeltaError(ValueError):
    """A deterministic validation or authorization failure."""


@dataclass(frozen=True)
class DeltaRow:
    work_id: str
    base_document_sha256: str
    new_document_sha256: str
    document: dict[str, Any]


@dataclass(frozen=True)
class DeltaInput:
    path: Path
    raw_sha256: str
    base_set_sha256: str
    rows: tuple[DeltaRow, ...]


@dataclass(frozen=True)
class Gate:
    path: Path
    file_sha256: str
    document: dict[str, Any]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise DeltaError(message)


def canonical_json(value: Any) -> bytes:
    """Match the fresh importer byte-for-byte canonical JSON definition."""
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and SHA256_RE.fullmatch(value) is not None


def validate_release_ref(value: Any) -> str:
    require(isinstance(value, str), "releaseRef must be a string")
    require(value != "" and value == value.strip(), "releaseRef must be nonblank and unpadded")
    require(len(value) <= 256, "releaseRef is too long")
    require(not any(ord(char) < 0x20 or ord(char) == 0x7F for char in value), "releaseRef contains a control byte")
    return value


def _nested_text(document: dict[str, Any], path: Sequence[str]) -> str | None:
    value: Any = document
    for key in path:
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value if isinstance(value, str) else None


def validate_document(document: Any, work_id: str, *, line_number: int) -> dict[str, Any]:
    label = f"delta line {line_number} ({work_id})"
    require(isinstance(document, dict), f"{label}: document must be an object")
    require(set(document) == DOCUMENT_TOP_LEVEL, f"{label}: document top-level shape drift")
    require("legacy" not in document, f"{label}: retired legacy block is forbidden")
    require(document.get("contractVersion") == CONTRACT_VERSION, f"{label}: contractVersion drift")
    require(document.get("workId") == work_id, f"{label}: document/workId mismatch")
    for block in ACTIVE_BLOCKS:
        require(isinstance(document[block], dict), f"{label}: block {block} must be an object")
    canonical_title = _nested_text(document, ("canonical", "naming", "canonicalTitle"))
    require(canonical_title is not None and canonical_title.strip() != "", f"{label}: canonical title is missing")
    audit_run_ref = _nested_text(document, ("provenance", "auditRunRef"))
    require(audit_run_ref is not None and audit_run_ref.strip() != "", f"{label}: auditRunRef is missing")
    return document


def load_delta(path: Path) -> DeltaInput:
    require(path.is_file(), f"delta file is missing: {path}")
    payload = path.read_bytes()
    require(payload != b"", "delta file is empty")
    require(payload.endswith(b"\n"), "delta JSONL must end with LF")
    require(b"\r" not in payload, "delta JSONL contains a CR byte")

    rows: list[DeltaRow] = []
    work_ids: set[str] = set()
    base_hashes: set[str] = set()
    new_hashes: set[str] = set()
    for line_number, raw_line in enumerate(payload.splitlines(), 1):
        require(raw_line != b"", f"blank delta line: {line_number}")
        try:
            value = json.loads(raw_line)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise DeltaError(f"invalid JSON at delta line {line_number}: {exc}") from exc
        require(isinstance(value, dict), f"delta line {line_number}: expected object")
        require(canonical_json(value) == raw_line, f"delta line {line_number}: JSON is not canonical")
        require(set(value) == DELTA_ROW_FIELDS, f"delta line {line_number}: row shape drift")
        require(value["schemaVersion"] == DELTA_ROW_VERSION, f"delta line {line_number}: schemaVersion drift")
        work_id = value["workId"]
        require(isinstance(work_id, str) and work_id.strip() != "" and work_id == work_id.strip(), f"delta line {line_number}: invalid workId")
        require(work_id not in work_ids, f"duplicate workId in delta: {work_id}")
        work_ids.add(work_id)
        base_sha256 = value["baseDocumentSha256"]
        require(is_sha256(base_sha256), f"delta line {line_number}: invalid baseDocumentSha256")
        require(base_sha256 not in base_hashes, f"duplicate baseDocumentSha256 in delta: {base_sha256}")
        base_hashes.add(base_sha256)
        document = validate_document(value["document"], work_id, line_number=line_number)
        new_sha256 = sha256_bytes(canonical_json(document))
        require(new_sha256 != base_sha256, f"delta line {line_number}: no-op document replacement")
        require(new_sha256 not in new_hashes, f"duplicate new document SHA-256 in delta: {new_sha256}")
        new_hashes.add(new_sha256)
        rows.append(DeltaRow(work_id, base_sha256, new_sha256, document))

    ordered = sorted(rows, key=lambda row: (len(row.work_id), row.work_id))
    base_set = b"".join(
        f"{row.work_id}\t{row.base_document_sha256}\n".encode("utf-8")
        for row in ordered
    )
    return DeltaInput(
        path=path,
        raw_sha256=sha256_bytes(payload),
        base_set_sha256=sha256_bytes(base_set),
        rows=tuple(rows),
    )


def load_gate(path: Path) -> Gate:
    require(path.is_file(), f"gate file is missing: {path}")
    payload = path.read_bytes()
    require(b"\r" not in payload, "gate contains a CR byte")
    try:
        value = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DeltaError(f"invalid gate JSON: {exc}") from exc
    require(isinstance(value, dict), "gate must be an object")
    require(set(value) == GATE_FIELDS, "gate root shape drift")
    require(value["schemaVersion"] == GATE_VERSION, "gate schemaVersion drift")
    require(type(value["applyEnabled"]) is bool, "gate applyEnabled must be boolean")
    validate_release_ref(value["releaseRef"])
    require(is_sha256(value["deltaSha256"]), "gate deltaSha256 is invalid")
    require(is_sha256(value["baseSetSha256"]), "gate baseSetSha256 is invalid")
    require(type(value["rowCount"]) is int and value["rowCount"] >= 0, "gate rowCount is invalid")
    return Gate(path=path, file_sha256=sha256_bytes(payload), document=value)


def validate_gate_binding(gate: Gate, delta: DeltaInput, release_ref: str) -> None:
    value = gate.document
    require(value["releaseRef"] == release_ref, "gate releaseRef does not match --release-ref")
    require(value["deltaSha256"] == delta.raw_sha256, "gate deltaSha256 does not match raw delta bytes")
    require(value["baseSetSha256"] == delta.base_set_sha256, "gate baseSetSha256 does not match the delta base set")
    require(value["rowCount"] == len(delta.rows), "gate rowCount does not match the delta")


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


def assert_update_only_sql(sql: str) -> None:
    without_literals = _strip_single_quoted_literals(sql)
    without_comments = re.sub(r"--[^\n]*", "", without_literals)
    tokens = set(re.findall(r"[A-Za-z_]+", without_comments.upper()))
    forbidden = sorted(tokens & FORBIDDEN_SQL_TOKENS)
    require(not forbidden, f"generated SQL contains forbidden write token(s): {', '.join(forbidden)}")
    require("FOR UPDATE OF W" in without_comments.upper(), "generated SQL lacks target-row FOR UPDATE")
    require(without_comments.upper().count("UPDATE GLOBAL_WORK_LINEAGE_V01.WORK_LINEAGES") == 1, "generated SQL update scope drift")
    require("BASE_DOCUMENT_SHA256" in without_comments.upper(), "generated SQL lacks document_sha256 CAS")


def render_sql(delta: DeltaInput, release_ref: str) -> bytes:
    values = []
    for row in delta.rows:
        document_text = canonical_json(row.document).decode("utf-8")
        values.append(
            "      ("
            + ", ".join(
                (
                    f"{sql_literal(row.work_id)}::text",
                    f"{sql_literal(row.base_document_sha256)}::text",
                    f"{sql_literal(row.new_document_sha256)}::text",
                    f"{sql_literal(document_text)}::text",
                )
            )
            + ")"
        )
    values_sql = ",\n".join(values)
    sql = f"""\\set ON_ERROR_STOP on
-- Global Work Lineage v01 existing-row CAS delta.
-- releaseRef: {release_ref}
-- rawDeltaSha256: {delta.raw_sha256}
-- baseSetSha256: {delta.base_set_sha256}
-- rowCount: {len(delta.rows)}
BEGIN;
SET LOCAL standard_conforming_strings = on;

DO $global_work_lineage_delta_v01$
DECLARE
  staged record;
  actual_sha256 text;
  changed_rows integer;
BEGIN
  FOR staged IN
    SELECT delta.*
    FROM (VALUES
{values_sql}
    ) AS delta(work_id, base_document_sha256, new_document_sha256, document_text)
    ORDER BY length(delta.work_id), delta.work_id
  LOOP
    SELECT w.document_sha256::text
      INTO actual_sha256
      FROM global_work_lineage_v01.work_lineages AS w
     WHERE w.work_id = staged.work_id
       FOR UPDATE OF w;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Global Work Lineage delta target work_id does not exist: %', staged.work_id;
    END IF;
    IF actual_sha256 <> staged.base_document_sha256 THEN
      RAISE EXCEPTION 'Global Work Lineage delta CAS mismatch for work_id %: expected %, found %',
        staged.work_id, staged.base_document_sha256, actual_sha256;
    END IF;

    UPDATE global_work_lineage_v01.work_lineages
       SET document_sha256 = staged.new_document_sha256,
           document = staged.document_text::jsonb
     WHERE work_id = staged.work_id
       AND document_sha256 = staged.base_document_sha256;
    GET DIAGNOSTICS changed_rows = ROW_COUNT;
    IF changed_rows <> 1 THEN
      RAISE EXCEPTION 'Global Work Lineage delta CAS update count drift for work_id %: %',
        staged.work_id, changed_rows;
    END IF;
  END LOOP;
END
$global_work_lineage_delta_v01$;

COMMIT;
"""
    assert_update_only_sql(sql)
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
    env["PGAPPNAME"] = "baihepailei-global-work-lineage-delta-v01"
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
        raise DeltaError(f"psql CAS delta failed:\n{details}")


def build_receipt(
    *,
    delta: DeltaInput,
    release_ref: str,
    sql_sha256: str,
    gate: Gate | None,
    applied: bool,
) -> dict[str, Any]:
    return {
        "schemaVersion": RECEIPT_VERSION,
        "status": "PASS_APPLIED" if applied else "PASS_OFFLINE_VALIDATED",
        "contractVersion": CONTRACT_VERSION,
        "frozenBlockCount": FROZEN_BLOCK_COUNT,
        "activeTopLevelBlocks": list(ACTIVE_BLOCKS),
        "releaseRef": release_ref,
        "delta": {
            "path": delta.path.name,
            "rawSha256": delta.raw_sha256,
            "baseSetSha256": delta.base_set_sha256,
            "rowCount": len(delta.rows),
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
        "output": {
            "sql": {
                "path": "apply.sql",
                "sha256": sql_sha256,
            }
        },
        "execution": {
            "databaseWrite": applied,
            "operation": "UPDATE_EXISTING_WORK_ID_ONLY",
            "target": "global_work_lineage_v01.work_lineages",
            "rowLock": "FOR UPDATE",
            "compareAndSwap": "document_sha256",
            "insertRows": 0,
            "deleteRows": 0,
            "upsertRows": 0,
            "compatibilityLayer": False,
        },
    }


def run(
    *,
    delta_path: Path,
    release_ref: str,
    out_dir: Path,
    gate_path: Path | None = None,
    apply: bool = False,
    database_url: str | None = None,
    confirm_release_ref: str | None = None,
    psql_bin: str = "psql",
) -> dict[str, Any]:
    release_ref = validate_release_ref(release_ref)
    require(not out_dir.exists(), f"output path already exists: {out_dir}")
    delta = load_delta(delta_path)
    gate = load_gate(gate_path) if gate_path is not None else None
    if gate is not None:
        validate_gate_binding(gate, delta, release_ref)

    if apply:
        require(gate is not None, "--gate is required with --apply")
        require(gate.document["applyEnabled"] is True, "gate applyEnabled is not true")
        require(database_url is not None and database_url != "", "--database-url is required with --apply")
        require(confirm_release_ref is not None, "--confirm-release-ref is required with --apply")
        require(confirm_release_ref == release_ref, "--confirm-release-ref does not exactly match --release-ref")
    else:
        require(database_url is None, "--database-url is only accepted with --apply")
        require(confirm_release_ref is None, "--confirm-release-ref is only accepted with --apply")

    sql = render_sql(delta, release_ref)
    out_dir.mkdir(parents=True)
    sql_path = out_dir / "apply.sql"
    sql_path.write_bytes(sql)
    if apply:
        execute_sql(str(database_url), sql_path, psql_bin)
    receipt = build_receipt(
        delta=delta,
        release_ref=release_ref,
        sql_sha256=sha256_bytes(sql),
        gate=gate,
        applied=apply,
    )
    receipt_bytes = (json.dumps(receipt, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    (out_dir / "receipt.json").write_bytes(receipt_bytes)
    return receipt


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate and optionally apply a Global Work Lineage v01 existing-row CAS delta."
    )
    parser.add_argument("--delta", type=Path, required=True, help="canonical delta JSONL")
    parser.add_argument("--release-ref", required=True, help="immutable/versioned release reference")
    parser.add_argument("--out-dir", type=Path, required=True, help="new directory for apply.sql and receipt.json")
    parser.add_argument("--gate", type=Path, help="versioned exact-binding apply gate")
    parser.add_argument("--apply", action="store_true", help="execute the generated CAS SQL through psql")
    parser.add_argument("--database-url", help="explicit postgres/postgresql URL; accepted only with --apply")
    parser.add_argument("--confirm-release-ref", help="must exactly repeat --release-ref when applying")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        receipt = run(
            delta_path=args.delta.resolve(),
            release_ref=args.release_ref,
            out_dir=args.out_dir.resolve(),
            gate_path=args.gate.resolve() if args.gate else None,
            apply=args.apply,
            database_url=args.database_url,
            confirm_release_ref=args.confirm_release_ref,
        )
    except (DeltaError, OSError) as exc:
        print(f"GLOBAL WORK LINEAGE DELTA: FAIL: {exc}", file=sys.stderr)
        return 2
    sys.stdout.buffer.write((json.dumps(receipt, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
