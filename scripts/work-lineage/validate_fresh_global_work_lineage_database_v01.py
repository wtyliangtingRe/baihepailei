#!/usr/bin/env python3
"""Validate the fresh WorkLineage database without any legacy or package input."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


EXPECTED_TARGET_RELATIONS = [
    {"kind": "r", "name": "provenance_objects"},
    {"kind": "r", "name": "work_lineages"},
]


def fail(message: str) -> None:
    raise SystemExit(f"FRESH WORK LINEAGE DATABASE VALIDATION: FAIL: {message}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), f"expected object: {path}")
    return value


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def is_sha256(value: Any, *, prefixed: bool = False) -> bool:
    text = str(value)
    if prefixed:
        if not text.startswith("sha256:"):
            return False
        text = text.removeprefix("sha256:")
    return len(text) == 64 and all(char in "0123456789abcdef" for char in text)


def psql(database_url: str, query: str) -> bytes:
    env = os.environ.copy()
    env["PGOPTIONS"] = "-c default_transaction_read_only=on"
    proc = subprocess.run(
        [
            "psql",
            "--no-psqlrc",
            "--set",
            "ON_ERROR_STOP=1",
            "--tuples-only",
            "--no-align",
            "--dbname",
            database_url,
            "--command",
            query,
        ],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        fail(proc.stderr.decode("utf-8", errors="replace"))
    return proc.stdout


def query_stats(database_url: str) -> dict[str, Any]:
    query = r"""
WITH expanded_bindings AS (
  SELECT
    binding ->> 'bindingId' AS binding_id,
    binding #>> '{externalIdentity,providerIdentityKey}' AS provider_identity_key
  FROM global_work_lineage_v01.work_lineages AS work,
       LATERAL jsonb_array_elements(work.document #> '{identities,bindings}') AS binding
),
stats AS (
  SELECT
    (SELECT count(*) FROM global_work_lineage_v01.work_lineages) AS formal_rows,
    (SELECT count(*) FROM expanded_bindings) AS binding_rows,
    (SELECT count(DISTINCT binding_id) FROM expanded_bindings) AS unique_binding_ids,
    (SELECT count(DISTINCT provider_identity_key) FROM expanded_bindings) AS unique_provider_identity_keys,
    (SELECT count(*) FROM global_work_lineage_v01.work_lineages WHERE document #>> '{identities,observation,state}' = 'partial') AS partial_identity_rows,
    (SELECT count(*) FROM global_work_lineage_v01.work_lineages WHERE document ? 'legacy') AS legacy_rows,
    (SELECT count(*) FROM global_work_lineage_v01.work_lineages WHERE document #>> '{research,observation,state}' <> 'not_observed') AS migrated_research_rows,
    (SELECT count(*) FROM global_work_lineage_v01.work_lineages WHERE jsonb_array_length(document #> '{assessment,attempts}') <> 0) AS migrated_assessment_rows,
    (SELECT count(*) FROM global_work_lineage_v01.work_lineages WHERE jsonb_array_length(document #> '{candidate,records}') <> 0) AS migrated_candidate_rows,
    (SELECT count(*) FROM global_work_lineage_v01.work_lineages WHERE jsonb_array_length(document #> '{published,entries}') <> 0) AS migrated_published_rows,
    (SELECT count(*) FROM global_work_lineage_v01.work_lineages WHERE jsonb_array_length(document #> '{human,judgments}') <> 0) AS migrated_human_rows,
    (SELECT count(*) FROM global_work_lineage_v01.work_lineages WHERE work_id = '39355') AS dropped_test_rows,
    (SELECT count(*) FROM global_work_lineage_v01.work_lineages WHERE (document #>> '{effectiveState,ai,selection,failClosed}')::boolean IS NOT TRUE) AS open_ai_selection_rows,
    (SELECT count(*) FROM global_work_lineage_v01.provenance_objects) AS provenance_objects,
    (SELECT count(*) FROM global_work_lineage_v01.provenance_objects WHERE object_kind = 'observation') AS provenance_observations,
    (SELECT count(*) FROM global_work_lineage_v01.work_lineages AS work LEFT JOIN global_work_lineage_v01.provenance_objects AS provenance ON provenance.object_ref = work.audit_run_ref WHERE provenance.object_ref IS NULL) AS broken_audit_refs,
    (
      SELECT coalesce(
        json_agg(
          json_build_object('kind', relation.relkind::text, 'name', relation.relname)
          ORDER BY relation.relname
        ),
        '[]'::json
      )
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'global_work_lineage_v01'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    ) AS target_relations,
    (
      SELECT count(*)
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'global_work_lineage_v01')
        AND namespace.nspname NOT LIKE 'pg_toast%'
        AND namespace.nspname NOT LIKE 'pg_temp_%'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    ) AS outside_target_relations,
    (SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'global_work_lineage_v01') AND table_type = 'BASE TABLE') AS outside_target_tables
)
SELECT json_build_object(
  'formalWorkLineageRows', formal_rows,
  'formalIdentityBindings', binding_rows,
  'uniqueBindingIds', unique_binding_ids,
  'uniqueProviderIdentityKeys', unique_provider_identity_keys,
  'partialIdentityRows', partial_identity_rows,
  'legacyRows', legacy_rows,
  'legacyResearchRows', migrated_research_rows,
  'legacyAssessmentRows', migrated_assessment_rows,
  'legacyCandidateRows', migrated_candidate_rows,
  'legacyPublishedRows', migrated_published_rows,
  'legacyHumanRows', migrated_human_rows,
  'droppedTestRows', dropped_test_rows,
  'openAiSelectionRows', open_ai_selection_rows,
  'provenanceObjects', provenance_objects,
  'provenanceObservations', provenance_observations,
  'brokenAuditRefs', broken_audit_refs,
  'targetRelations', target_relations,
  'outsideTargetRelations', outside_target_relations,
  'outsideTargetTables', outside_target_tables
)::text
FROM stats;
"""
    payload = psql(database_url, query).decode("utf-8").strip()
    value = json.loads(payload)
    require(isinstance(value, dict), "database stats query did not return an object")
    return value


def query_document_set(database_url: str, table: str, ref_column: str) -> tuple[int, str]:
    require(
        (table, ref_column)
        in {
            ("work_lineages", "work_id"),
            ("provenance_objects", "object_ref"),
        },
        "unsafe digest query target",
    )
    order = "length(work_id), work_id" if table == "work_lineages" else "object_ref"
    query = (
        "SELECT json_build_object("
        f"'ref', {ref_column}, 'documentSha256', document_sha256, 'document', document)::text "
        f"FROM global_work_lineage_v01.{table} ORDER BY {order};"
    )
    digest_payload = bytearray()
    refs: set[str] = set()
    rows = 0
    for line in psql(database_url, query).splitlines():
        require(line, f"blank database document row: {table}")
        wrapper = json.loads(line)
        require(isinstance(wrapper, dict), f"invalid database document wrapper: {table}")
        ref = str(wrapper["ref"])
        require(ref and ref not in refs, f"missing/duplicate database object ref: {table}:{ref}")
        refs.add(ref)
        supplied = str(wrapper["documentSha256"])
        recomputed = hashlib.sha256(canonical_json(wrapper["document"])).hexdigest()
        require(supplied == recomputed, f"stored document digest mismatch: {table}:{ref}")
        digest_payload.extend(f"{ref}\t{supplied}\n".encode("utf-8"))
        rows += 1
    return rows, hashlib.sha256(digest_payload).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--allow-other-schemas", action="store_true")
    args = parser.parse_args()

    lock = load_json(args.lock.resolve())
    require(lock["schemaVersion"] == "global-work-lineage-fresh-database-import-lock-v01", "lock schema drift")
    require(lock["contractVersion"] == "global-work-lineage-v01", "lock contract drift")
    require(lock["frozenBlockCount"] == 13, "lock Frozen block census drift")
    require(lock["legacyModuleMode"] == "retired", "lock Legacy mode drift")
    target = lock["target"]
    require(target["databaseMustBeEmpty"] is True, "lock permits non-empty import")
    require(target["compatibilityBridges"] == 0, "lock permits compatibility bridges")
    require(target["legacyRuntimeDependencies"] == 0, "lock permits legacy runtime dependencies")
    require(target["referenceRuntimeDependencies"] == 0, "lock permits reference runtime dependencies")
    expected = lock["formalPackage"]
    for key in ("sha256SumsSha256", "documentSetSha256", "provenanceObjectSetSha256"):
        require(is_sha256(expected[key]), f"invalid locked SHA-256: {key}")
    for key in ("outputManifestHash", "provenanceRootHash"):
        require(is_sha256(expected[key], prefixed=True), f"invalid locked content hash: {key}")
    counts = expected["counts"]
    stats = query_stats(args.database_url)

    require(stats["formalWorkLineageRows"] == counts["formalWorkLineageRows"], "formal row count drift")
    require(stats["formalIdentityBindings"] == counts["formalIdentityBindings"], "binding count drift")
    require(stats["uniqueBindingIds"] == counts["formalIdentityBindings"], "binding ID uniqueness failure")
    require(stats["uniqueProviderIdentityKeys"] == counts["formalIdentityBindings"], "provider identity ownership conflict")
    require(stats["partialIdentityRows"] == counts["partialIdentityRows"], "partial identity count drift")
    for key in (
        "legacyRows",
        "legacyResearchRows",
        "legacyAssessmentRows",
        "legacyCandidateRows",
        "legacyPublishedRows",
        "legacyHumanRows",
        "droppedTestRows",
        "openAiSelectionRows",
        "brokenAuditRefs",
    ):
        require(stats[key] == 0, f"forbidden database state: {key}={stats[key]}")
    require(stats["provenanceObjects"] == counts["provenanceObjects"], "provenance object count drift")
    require(stats["provenanceObservations"] == 2, "provenance Observation count drift")
    require(stats["targetRelations"] == EXPECTED_TARGET_RELATIONS, "target schema relation set drift")
    if not args.allow_other_schemas:
        require(stats["outsideTargetRelations"] == 0, "target database has outside persistent relations")
        require(stats["outsideTargetTables"] == 0, "target database is not isolated/fresh")

    document_rows, document_set_sha = query_document_set(args.database_url, "work_lineages", "work_id")
    provenance_rows, provenance_set_sha = query_document_set(args.database_url, "provenance_objects", "object_ref")
    require(document_rows == counts["formalWorkLineageRows"], "database document row count drift")
    require(provenance_rows == counts["provenanceObjects"], "database provenance document count drift")
    require(document_set_sha == expected["documentSetSha256"], "database formal document-set digest drift")
    require(provenance_set_sha == expected["provenanceObjectSetSha256"], "database provenance object-set digest drift")

    result = {
        "schemaVersion": "global-work-lineage-fresh-database-validation-v01",
        "status": "PASS_FRESH_ISOLATED_DATABASE",
        "packageId": lock["packageId"],
        "contractVersion": "global-work-lineage-v01",
        "frozenBlockCount": 13,
        "stats": stats,
        "documentSetSha256": document_set_sha,
        "provenanceObjectSetSha256": provenance_set_sha,
        "importBoundary": {
            "requiresEmptyDatabase": True,
            "plainInsertOnly": True,
        },
        "dependencyProof": {
            "formalPackageRead": False,
            "legacySourceRead": False,
            "legacyDatabaseConnections": 0,
            "referencePackageRead": False,
            "compatibilityBridges": 0,
            "dualReads": 0,
        },
    }
    rendered = (json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_bytes(rendered)
    sys.stdout.buffer.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
