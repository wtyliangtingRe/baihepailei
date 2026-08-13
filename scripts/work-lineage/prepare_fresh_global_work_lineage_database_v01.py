#!/usr/bin/env python3
"""Validate a sealed formal package and prepare an empty PostgreSQL import."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable


FORMAL_FILES = {
    "SHA256SUMS",
    "audit-run.json",
    "formal-work-lineage.jsonl",
    "manifest.json",
    "output-manifest.json",
    "provenance-bundle.json",
    "provenance-observations.jsonl",
}
FROZEN_BLOCKS = {
    "canonical",
    "identities",
    "research",
    "assessment",
    "candidate",
    "published",
    "human",
    "legacy",
    "reservations",
    "quarantine",
    "effectiveState",
    "integrity",
    "provenance",
}
ACTIVE_BLOCKS = FROZEN_BLOCKS - {"legacy"}
FORMAL_TOP_LEVEL = ACTIVE_BLOCKS | {"contractVersion", "workId"}
BINDING_FIELDS = {
    "bindingId",
    "externalIdentity",
    "bindingState",
    "verificationState",
    "freshnessState",
    "validityState",
    "scopeMatch",
    "validFrom",
    "validUntil",
    "supersedesBindingId",
}
EXTERNAL_IDENTITY_FIELDS = {
    "provider",
    "namespace",
    "externalId",
    "providerIdentityKey",
}
OBSERVATION_FIELDS = {
    "observationId",
    "observationType",
    "scopeRef",
    "state",
    "sourceRefs",
    "observedAt",
    "methodRef",
    "resultRows",
    "resultSha256",
}


def fail(message: str) -> None:
    raise SystemExit(f"FRESH WORK LINEAGE DATABASE PREPARE: FAIL: {message}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def content_hash(value: Any) -> str:
    return f"sha256:{sha256_bytes(canonical_json(value))}"


def is_sha256(value: Any, *, prefixed: bool = False) -> bool:
    text = str(value)
    if prefixed:
        if not text.startswith("sha256:"):
            return False
        text = text.removeprefix("sha256:")
    return len(text) == 64 and all(char in "0123456789abcdef" for char in text)


def load_json(path: Path) -> dict[str, Any]:
    payload = path.read_bytes()
    require(b"\r" not in payload, f"CR byte found: {path.name}")
    value = json.loads(payload)
    require(isinstance(value, dict), f"expected object: {path.name}")
    return value


def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("rb") as handle:
        for line_number, line in enumerate(handle, 1):
            require(line.endswith(b"\n"), f"JSONL missing trailing LF: {path.name}:{line_number}")
            require(b"\r" not in line, f"CR byte found: {path.name}:{line_number}")
            payload = line[:-1]
            require(payload, f"blank JSONL row: {path.name}:{line_number}")
            value = json.loads(payload)
            require(isinstance(value, dict), f"expected object: {path.name}:{line_number}")
            require(canonical_json(value) == payload, f"non-canonical JSONL row: {path.name}:{line_number}")
            yield value


def verify_sha256sums(package: Path) -> tuple[str, dict[str, str]]:
    payload = (package / "SHA256SUMS").read_bytes()
    require(payload.endswith(b"\n") and b"\r" not in payload, "invalid SHA256SUMS line endings")
    declared: dict[str, str] = {}
    for line in payload.decode("utf-8").splitlines():
        digest, separator, name = line.partition("  ")
        require(separator == "  ", f"invalid SHA256SUMS line: {line}")
        require(name not in declared, f"duplicate SHA256SUMS member: {name}")
        require(len(digest) == 64 and all(char in "0123456789abcdef" for char in digest), f"invalid digest: {name}")
        declared[name] = digest
    require(set(declared) == FORMAL_FILES - {"SHA256SUMS"}, "formal SHA256SUMS member set drift")
    for name, digest in declared.items():
        require(sha256_bytes((package / name).read_bytes()) == digest, f"checksum mismatch: {name}")
    return sha256_bytes(payload), declared


def expected_binding_id(work_id: str, binding: dict[str, Any], observation_ref: str) -> str:
    payload = {
        "workId": work_id,
        "externalIdentity": binding["externalIdentity"],
        "bindingState": binding["bindingState"],
        "verificationState": binding["verificationState"],
        "freshnessState": binding["freshnessState"],
        "validityState": binding["validityState"],
        "scopeMatch": binding["scopeMatch"],
        "validFrom": binding["validFrom"],
        "validUntil": binding["validUntil"],
        "supersedesBindingId": binding["supersedesBindingId"],
        "provenanceObservationRefs": [observation_ref],
    }
    return f"identity-binding-v01:{content_hash(payload)}"


def load_lock(path: Path) -> dict[str, Any]:
    lock = load_json(path)
    require(
        set(lock)
        == {
            "schemaVersion",
            "packageId",
            "contractVersion",
            "frozenBlockCount",
            "legacyModuleMode",
            "formalPackage",
            "target",
        },
        "lock root shape drift",
    )
    require(lock["schemaVersion"] == "global-work-lineage-fresh-database-import-lock-v01", "lock schema drift")
    require(lock["contractVersion"] == "global-work-lineage-v01", "lock contract drift")
    require(lock["frozenBlockCount"] == 13, "lock Frozen block census drift")
    require(lock["legacyModuleMode"] == "retired", "lock Legacy mode drift")
    require(lock["target"]["databaseMustBeEmpty"] is True, "lock permits non-empty database")
    require(lock["target"]["compatibilityBridges"] == 0, "lock permits compatibility bridge")
    require(lock["target"]["legacyRuntimeDependencies"] == 0, "lock permits legacy dependency")
    require(lock["target"]["referenceRuntimeDependencies"] == 0, "lock permits reference dependency")
    formal = lock["formalPackage"]
    require(
        set(formal)
        == {
            "sha256SumsSha256",
            "outputManifestHash",
            "provenanceRootHash",
            "documentSetSha256",
            "provenanceObjectSetSha256",
            "counts",
        },
        "lock formal-package shape drift",
    )
    for key in ("sha256SumsSha256", "documentSetSha256", "provenanceObjectSetSha256"):
        require(is_sha256(formal[key]), f"invalid locked SHA-256: {key}")
    for key in ("outputManifestHash", "provenanceRootHash"):
        require(is_sha256(formal[key], prefixed=True), f"invalid locked content hash: {key}")
    require(
        set(formal["counts"])
        == {
            "formalWorkLineageRows",
            "formalIdentityBindings",
            "partialIdentityRows",
            "provenanceObjects",
        },
        "lock count shape drift",
    )
    return lock


def validate_package(package: Path, lock: dict[str, Any]) -> tuple[list[dict[str, Any]], list[tuple[str, str, dict[str, Any]]], dict[str, Any]]:
    require(package.is_dir(), "formal package must be a directory")
    require({path.name for path in package.iterdir()} == FORMAL_FILES, "formal package member set drift")
    sums_sha, declared = verify_sha256sums(package)
    expected = lock["formalPackage"]
    require(sums_sha == expected["sha256SumsSha256"], "formal SHA256SUMS digest drift")

    manifest = load_json(package / "manifest.json")
    require(manifest["packageId"] == lock["packageId"], "package ID drift")
    require(manifest["terminalOutcome"] == "FORMAL_IMPORT", "formal terminal outcome drift")
    require(manifest["contractVersion"] == "global-work-lineage-v01", "manifest contract drift")
    require(manifest["legacyModuleMode"] == "retired", "formal Legacy module not retired")
    require(manifest["isolation"]["formalPackageSelfContained"] is True, "formal package not self-contained")
    require(manifest["isolation"]["productionRuntimeLegacyDependencies"] == 0, "legacy runtime dependency appeared")
    require(manifest["isolation"]["productionRuntimeReferenceDependencies"] == 0, "reference runtime dependency appeared")
    require(manifest["isolation"]["compatibilityBridges"] == 0, "compatibility bridge appeared")
    require(manifest["isolation"]["dualReads"] == 0, "dual read appeared")
    require(manifest["outputManifestHash"] == expected["outputManifestHash"], "locked output manifest hash drift")
    require(manifest["provenanceRootHash"] == expected["provenanceRootHash"], "locked provenance root drift")

    output_manifest = load_json(package / "output-manifest.json")
    supplied_manifest_hash = output_manifest.pop("manifestHash")
    require(supplied_manifest_hash == content_hash(output_manifest), "OutputManifest self-hash drift")
    output_manifest["manifestHash"] = supplied_manifest_hash
    require(supplied_manifest_hash == manifest["outputManifestHash"], "formal/OutputManifest binding drift")
    outputs = {row["path"]: row for row in output_manifest["outputs"]}
    require(set(outputs) == {"formal-work-lineage.jsonl", "provenance-observations.jsonl"}, "formal output set drift")
    for name, output in outputs.items():
        payload = (package / name).read_bytes()
        require(output["sha256"] == sha256_bytes(payload), f"OutputManifest digest drift: {name}")
        require(output["bytes"] == len(payload), f"OutputManifest byte count drift: {name}")
        require(declared[name] == output["sha256"], f"SHA256SUMS/OutputManifest drift: {name}")

    provenance_bundle = load_json(package / "provenance-bundle.json")
    supplied_root = provenance_bundle.pop("provenanceRootHash")
    require(supplied_root == content_hash(provenance_bundle), "ProvenanceBundle root drift")
    provenance_bundle["provenanceRootHash"] = supplied_root
    require(supplied_root == manifest["provenanceRootHash"], "formal/ProvenanceBundle binding drift")
    archive = provenance_bundle["archivePolicyIdentity"]
    require(archive["formalPackageRuntimeIndependent"] is True, "formal independence disabled")
    require(archive["referencePackageRuntimeReadable"] is False, "reference runtime read enabled")
    require(archive["oldDatabaseRuntimeReadable"] is False, "old database runtime read enabled")

    audit_run = load_json(package / "audit-run.json")
    require(audit_run["state"] == "sealed", "AuditRun not sealed")
    require(audit_run["provenanceRootHash"] == supplied_root, "AuditRun root drift")

    observation_rows = list(iter_jsonl(package / "provenance-observations.jsonl"))
    require(len(observation_rows) == 2, "provenance Observation count drift")
    observations: dict[str, str] = {}
    provenance_objects: list[tuple[str, str, dict[str, Any]]] = []
    for row in observation_rows:
        require(set(row) == OBSERVATION_FIELDS, "provenance Observation shape drift")
        observation_id = row["observationId"]
        core = {key: value for key, value in row.items() if key != "observationId"}
        require(observation_id == f"provenance-observation-v01:{content_hash(core)}", "Observation content ID drift")
        require(row["state"] == "complete", "source Observation not complete")
        observation_type = row["observationType"]
        require(observation_type not in observations, "duplicate Observation type")
        observations[observation_type] = observation_id
        provenance_objects.append(("observation", observation_id, row))
    require(
        set(observations)
        == {
            "sealed_snapshot_canonical_workid_title_projection",
            "sealed_snapshot_exact_tuple_projection",
        },
        "Observation type set drift",
    )
    canonical_observation_id = observations["sealed_snapshot_canonical_workid_title_projection"]
    identity_observation_id = observations["sealed_snapshot_exact_tuple_projection"]

    formal_rows: list[dict[str, Any]] = []
    work_ids: set[str] = set()
    binding_ids: set[str] = set()
    provider_identity_keys: set[str] = set()
    partial_identity_rows = 0
    for row in iter_jsonl(package / "formal-work-lineage.jsonl"):
        work_id = str(row.get("workId", ""))
        require(work_id and work_id not in work_ids, f"missing/duplicate Work: {work_id}")
        work_ids.add(work_id)
        require(set(row) == FORMAL_TOP_LEVEL, f"formal top-level shape drift: {work_id}")
        require(len(FROZEN_BLOCKS) == 13 and "legacy" not in row, f"Frozen/Legacy boundary drift: {work_id}")
        require(row["contractVersion"] == "global-work-lineage-v01", f"contract drift: {work_id}")
        require(row["canonical"]["observation"]["state"] == "complete", f"canonical observation drift: {work_id}")
        require(row["canonical"]["observation"]["provenanceObservationRefs"] == [canonical_observation_id], f"canonical provenance drift: {work_id}")
        require(row["canonical"]["record"]["recordCardinality"] == 1, f"canonical cardinality drift: {work_id}")
        require(row["canonical"]["lifecycle"]["entityState"] == "unknown", f"legacy lifecycle invented: {work_id}")
        require(str(row["canonical"]["naming"]["canonicalTitle"]).strip(), f"blank canonical title: {work_id}")
        require(row["research"]["observation"]["state"] == "not_observed", f"legacy Research imported: {work_id}")
        require(not row["research"]["claims"] and not row["research"]["evidenceAnchors"], f"legacy Research payload imported: {work_id}")
        require(row["assessment"]["observation"]["state"] == "not_observed", f"legacy Assessment imported: {work_id}")
        require(not row["assessment"]["attempts"], f"legacy Assessment attempt imported: {work_id}")
        require(not row["candidate"]["records"], f"legacy Candidate imported: {work_id}")
        require(not row["published"]["entries"], f"legacy Published entry imported: {work_id}")
        require(not row["human"]["judgments"], f"legacy Human judgment imported: {work_id}")
        require(row["effectiveState"]["ai"]["selection"]["failClosed"] is True, f"AI selection open: {work_id}")
        require(row["provenance"]["auditRunRef"] == audit_run["auditRunId"], f"AuditRun ref drift: {work_id}")
        require(row["provenance"]["summary"]["legacyRuntimeDependency"] is False, f"legacy dependency: {work_id}")

        identities = row["identities"]
        refs = identities["observation"]["provenanceObservationRefs"]
        bindings = identities["bindings"]
        require(len(bindings) in {0, 1}, f"migration binding cardinality drift: {work_id}")
        if not bindings:
            partial_identity_rows += 1
            require(identities["observation"]["state"] == "partial", f"unbound identity not partial: {work_id}")
            require(refs == sorted([canonical_observation_id, identity_observation_id]), f"partial identity evidence drift: {work_id}")
            require(identities["derived"]["currentConfirmedBindingIds"] == [], f"unbound current binding drift: {work_id}")
            require(identities["derived"]["unresolvedBindingIds"] == [], f"unbound unresolved binding drift: {work_id}")
            require(identities["derived"]["currentExactProviderCount"] == 0, f"unbound provider count drift: {work_id}")
        else:
            require(identities["observation"]["state"] == "complete", f"bound identity not complete: {work_id}")
            require(refs == [identity_observation_id], f"bound identity evidence drift: {work_id}")
            binding = bindings[0]
            require(set(binding) == BINDING_FIELDS, f"IdentityBinding shape drift: {work_id}")
            require(binding["bindingId"] == expected_binding_id(work_id, binding, identity_observation_id), f"binding ID drift: {work_id}")
            require(binding["bindingId"] not in binding_ids, f"duplicate binding ID: {work_id}")
            binding_ids.add(binding["bindingId"])
            external = binding["externalIdentity"]
            require(set(external) == EXTERNAL_IDENTITY_FIELDS, f"external identity shape drift: {work_id}")
            require(
                all(str(external[key]).strip() for key in ("provider", "namespace", "externalId")),
                f"blank external identity component: {work_id}",
            )
            require("|" not in external["externalId"], f"unsafe provider identity delimiter: {work_id}")
            expected_key = f"{external['provider']}|{external['namespace']}|{external['externalId']}"
            require(external["providerIdentityKey"] == expected_key, f"provider identity key drift: {work_id}")
            require(expected_key not in provider_identity_keys, f"tuple ownership conflict: {work_id}")
            provider_identity_keys.add(expected_key)
            require(binding["bindingState"] == "current", f"binding state drift: {work_id}")
            require(binding["verificationState"] == "confirmed", f"verification drift: {work_id}")
            require(binding["freshnessState"] == "unknown", f"freshness invented: {work_id}")
            require(binding["validityState"] == "valid", f"validity drift: {work_id}")
            require(binding["scopeMatch"] == "exact", f"scope drift: {work_id}")
            require(binding["validFrom"] is None and binding["validUntil"] is None, f"initial validity interval drift: {work_id}")
            require(binding["supersedesBindingId"] is None, f"initial supersession drift: {work_id}")
            require(identities["derived"]["currentConfirmedBindingIds"] == [binding["bindingId"]], f"bound current binding drift: {work_id}")
            require(identities["derived"]["unresolvedBindingIds"] == [], f"bound unresolved binding drift: {work_id}")
            require(identities["derived"]["currentExactProviderCount"] == 1, f"bound provider count drift: {work_id}")
        formal_rows.append(row)

    counts = expected["counts"]
    require(len(formal_rows) == counts["formalWorkLineageRows"], "formal WorkLineage count drift")
    require(len(binding_ids) == counts["formalIdentityBindings"], "formal IdentityBinding count drift")
    require(partial_identity_rows == counts["partialIdentityRows"], "partial identity count drift")
    require("39355" not in work_ids, "dropped test Work entered formal package")

    provenance_objects.extend(
        [
            ("audit_run", audit_run["auditRunId"], audit_run),
            ("output_manifest", output_manifest["manifestId"], output_manifest),
            ("provenance_bundle", provenance_bundle["bundleId"], provenance_bundle),
            ("formal_package_manifest", manifest["packageId"], manifest),
        ]
    )
    require(len({item[1] for item in provenance_objects}) == len(provenance_objects), "duplicate provenance object ref")

    document_set = b"".join(
        f"{row['workId']}\t{sha256_bytes(canonical_json(row))}\n".encode("utf-8")
        for row in formal_rows
    )
    provenance_set = b"".join(
        f"{object_ref}\t{sha256_bytes(canonical_json(document))}\n".encode("utf-8")
        for _, object_ref, document in sorted(provenance_objects, key=lambda item: item[1])
    )
    require(sha256_bytes(document_set) == expected["documentSetSha256"], "formal document-set digest drift")
    require(sha256_bytes(provenance_set) == expected["provenanceObjectSetSha256"], "provenance object-set digest drift")

    stats = {
        "formalWorkLineageRows": len(formal_rows),
        "formalIdentityBindings": len(binding_ids),
        "partialIdentityRows": partial_identity_rows,
        "documentSetSha256": sha256_bytes(document_set),
        "provenanceObjects": len(provenance_objects),
        "provenanceObjectSetSha256": sha256_bytes(provenance_set),
        "formalSha256SumsSha256": sums_sha,
        "formalWorkLineageSha256": declared["formal-work-lineage.jsonl"],
    }
    return formal_rows, provenance_objects, stats


def write_tsv(path: Path, rows: Iterable[list[str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(
            handle,
            delimiter="\t",
            quotechar='"',
            quoting=csv.QUOTE_ALL,
            lineterminator="\n",
        )
        writer.writerows(rows)


def prepare_import(
    root: Path,
    out: Path,
    formal_rows: list[dict[str, Any]],
    provenance_objects: list[tuple[str, str, dict[str, Any]]],
    expected_counts: dict[str, int],
) -> dict[str, Any]:
    require(not out.exists(), f"output path already exists: {out}")
    out.mkdir(parents=True)
    work_tsv = out / "work-lineages.tsv"
    provenance_tsv = out / "provenance-objects.tsv"
    apply_sql = out / "apply.sql"

    write_tsv(
        work_tsv,
        (
            [str(row["workId"]), sha256_bytes(canonical_json(row)), canonical_json(row).decode("utf-8")]
            for row in formal_rows
        ),
    )
    write_tsv(
        provenance_tsv,
        (
            [kind, object_ref, sha256_bytes(canonical_json(document)), canonical_json(document).decode("utf-8")]
            for kind, object_ref, document in sorted(provenance_objects, key=lambda item: item[1])
        ),
    )

    schema_sql = (root / "database/global-work-lineage-v01/schema.sql").read_text(encoding="utf-8")
    require("IF NOT EXISTS" not in schema_sql.upper(), "schema must fail on existing targets")
    work_rows = int(expected_counts["formalWorkLineageRows"])
    provenance_rows = len(provenance_objects)
    sql = f"""\\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  existing_relations integer;
BEGIN
  SELECT count(*) INTO existing_relations
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
    AND namespace.nspname NOT LIKE 'pg_toast%'
    AND namespace.nspname NOT LIKE 'pg_temp_%'
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S');
  IF existing_relations <> 0 THEN
    RAISE EXCEPTION 'target database is not fresh: % persistent user relations already exist', existing_relations;
  END IF;
END
$$;

{schema_sql.rstrip()}

CREATE TEMP TABLE stage_provenance_objects (
  object_kind text NOT NULL,
  object_ref text NOT NULL,
  document_sha256 character(64) NOT NULL,
  document_text text NOT NULL
);

CREATE TEMP TABLE stage_work_lineages (
  work_id text NOT NULL,
  document_sha256 character(64) NOT NULL,
  document_text text NOT NULL
);

\\copy stage_provenance_objects (object_kind, object_ref, document_sha256, document_text) FROM 'provenance-objects.tsv' WITH (FORMAT csv, DELIMITER E'\\t', QUOTE '"');
\\copy stage_work_lineages (work_id, document_sha256, document_text) FROM 'work-lineages.tsv' WITH (FORMAT csv, DELIMITER E'\\t', QUOTE '"');

INSERT INTO global_work_lineage_v01.provenance_objects (
  object_kind,
  object_ref,
  document_sha256,
  document
)
SELECT object_kind, object_ref, document_sha256, document_text::jsonb
FROM stage_provenance_objects
ORDER BY object_ref;

INSERT INTO global_work_lineage_v01.work_lineages (
  work_id,
  document_sha256,
  document
)
SELECT work_id, document_sha256, document_text::jsonb
FROM stage_work_lineages
ORDER BY length(work_id), work_id;

DO $$
BEGIN
  IF (SELECT count(*) FROM global_work_lineage_v01.work_lineages) <> {work_rows} THEN
    RAISE EXCEPTION 'formal WorkLineage conservation failure';
  END IF;
  IF (SELECT count(*) FROM global_work_lineage_v01.provenance_objects) <> {provenance_rows} THEN
    RAISE EXCEPTION 'provenance object conservation failure';
  END IF;
  IF EXISTS (
    SELECT 1 FROM global_work_lineage_v01.work_lineages WHERE document ? 'legacy'
  ) THEN
    RAISE EXCEPTION 'retired Legacy block entered database';
  END IF;
END
$$;

COMMIT;
"""
    apply_sql.write_bytes(sql.encode("utf-8"))
    return {
        "workLineagesTsv": {"path": work_tsv.name, "sha256": sha256_bytes(work_tsv.read_bytes())},
        "provenanceObjectsTsv": {"path": provenance_tsv.name, "sha256": sha256_bytes(provenance_tsv.read_bytes())},
        "applySql": {"path": apply_sql.name, "sha256": sha256_bytes(apply_sql.read_bytes())},
    }


def execute_import(database_url: str, apply_sql: Path) -> None:
    require(database_url, "--database-url is required with --execute")
    env = os.environ.copy()
    env["PGOPTIONS"] = "-c default_transaction_read_only=off"
    proc = subprocess.run(
        ["psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--dbname", database_url, "--file", apply_sql.name],
        cwd=apply_sql.parent,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        fail(
            "psql import failed:\n"
            + proc.stdout.decode("utf-8", errors="replace")
            + proc.stderr.decode("utf-8", errors="replace")
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--formal-package", type=Path, required=True)
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--database-url")
    parser.add_argument("--proof", type=Path)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    lock = load_lock(args.lock.resolve())
    formal_rows, provenance_objects, stats = validate_package(args.formal_package.resolve(), lock)
    outputs = prepare_import(
        root,
        args.out.resolve(),
        formal_rows,
        provenance_objects,
        lock["formalPackage"]["counts"],
    )
    if args.execute:
        execute_import(str(args.database_url or ""), args.out.resolve() / "apply.sql")

    result = {
        "schemaVersion": "global-work-lineage-fresh-database-prepare-result-v01",
        "status": "PASS_IMPORTED" if args.execute else "PASS_PREPARED",
        "packageId": lock["packageId"],
        "contractVersion": "global-work-lineage-v01",
        "frozenBlockCount": 13,
        "legacyModuleMode": "retired",
        "stats": stats,
        "outputs": outputs,
        "execution": {
            "databaseWrite": bool(args.execute),
            "requiresEmptyDatabase": True,
            "upsert": False,
            "legacyDatabaseRead": False,
            "referencePackageRead": False,
            "compatibilityBridge": False,
        },
    }
    rendered = (json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    if args.proof:
        args.proof.parent.mkdir(parents=True, exist_ok=True)
        args.proof.write_bytes(rendered)
    sys.stdout.buffer.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
