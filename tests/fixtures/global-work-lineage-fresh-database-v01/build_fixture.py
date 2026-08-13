#!/usr/bin/env python3
"""Build a tiny sealed formal package for fresh-database integration tests."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


PACKAGE_ID = "GLOBAL-WORK-LINEAGE-V01-TEST-FORMAL-PACKAGE"
AUDIT_RUN_ID = "global-audit-run-v01:test-fresh-database"
OUTPUT_MANIFEST_ID = "global-output-manifest-v01:test-fresh-database"
PROVENANCE_BUNDLE_ID = "global-provenance-bundle-v01:test-fresh-database"


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def content_hash(value: Any) -> str:
    return f"sha256:{sha256_bytes(canonical_json(value))}"


def content_id(prefix: str, value: Any) -> str:
    return f"{prefix}:{content_hash(value)}"


def write_json(path: Path, value: Any) -> None:
    path.write_bytes((json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"))


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_bytes(b"".join(canonical_json(row) + b"\n" for row in rows))


def observation(observation_type: str, result_rows: int, result_sha: str) -> dict[str, Any]:
    core = {
        "observationType": observation_type,
        "scopeRef": f"test:{observation_type}",
        "state": "complete",
        "sourceRefs": [f"test-source:{observation_type}"],
        "observedAt": "2026-08-14T00:00:00Z",
        "methodRef": "test-fixture-v01",
        "resultRows": result_rows,
        "resultSha256": result_sha,
    }
    return {"observationId": content_id("provenance-observation-v01", core), **core}


def empty_observation(state: str, refs: list[str]) -> dict[str, Any]:
    return {"state": state, "provenanceObservationRefs": refs}


def make_binding(work_id: str, observation_id: str) -> dict[str, Any]:
    external_identity = {
        "provider": "test-provider",
        "namespace": "test-namespace",
        "externalId": "100",
        "providerIdentityKey": "test-provider|test-namespace|100",
    }
    payload = {
        "workId": work_id,
        "externalIdentity": external_identity,
        "bindingState": "current",
        "verificationState": "confirmed",
        "freshnessState": "unknown",
        "validityState": "valid",
        "scopeMatch": "exact",
        "validFrom": None,
        "validUntil": None,
        "supersedesBindingId": None,
        "provenanceObservationRefs": [observation_id],
    }
    return {
        "bindingId": content_id("identity-binding-v01", payload),
        "externalIdentity": external_identity,
        "bindingState": "current",
        "verificationState": "confirmed",
        "freshnessState": "unknown",
        "validityState": "valid",
        "scopeMatch": "exact",
        "validFrom": None,
        "validUntil": None,
        "supersedesBindingId": None,
    }


def make_row(
    work_id: str,
    title: str,
    canonical_observation_id: str,
    identity_observation_id: str,
    with_binding: bool,
) -> dict[str, Any]:
    bindings = [make_binding(work_id, identity_observation_id)] if with_binding else []
    identity_refs = (
        [identity_observation_id]
        if with_binding
        else sorted([canonical_observation_id, identity_observation_id])
    )
    identity_state = "complete" if with_binding else "partial"
    binding_ids = [binding["bindingId"] for binding in bindings]
    return {
        "contractVersion": "global-work-lineage-v01",
        "workId": work_id,
        "canonical": {
            "observation": empty_observation("complete", [canonical_observation_id]),
            "record": {"recordCardinality": 1, "presenceState": "present", "validityState": "valid"},
            "naming": {"canonicalTitle": title, "names": [title]},
            "classification": {"workType": "unknown"},
            "summary": None,
            "lifecycle": {"entityState": "unknown"},
            "recordMetadata": {"createdAt": None, "updatedAt": None},
        },
        "identities": {
            "observation": empty_observation(identity_state, identity_refs),
            "bindings": bindings,
            "derived": {
                "currentConfirmedBindingIds": binding_ids,
                "unresolvedBindingIds": [],
                "currentExactProviderCount": len(bindings),
            },
        },
        "research": {
            "observation": empty_observation("not_observed", []),
            "observations": [],
            "sources": [],
            "retrievals": [],
            "evidenceAnchors": [],
            "claims": [],
            "conflicts": [],
            "unresolvedQuestions": [],
            "derived": {
                "hasResearchHistory": False,
                "effectiveClaimIds": [],
                "currentReadiness": "not_observed",
                "recommendedNextAction": "run_current_discovery_or_research",
            },
        },
        "assessment": {"observation": empty_observation("not_observed", []), "attempts": [], "derived": {}},
        "candidate": {"observation": empty_observation("not_observed", []), "generationAttempts": [], "records": [], "derived": {}},
        "published": {
            "observation": {
                "state": "not_observed",
                "provenanceObservationRefs": [],
                "artifactGroups": [],
                "derivedOccupancy": "unknown",
            },
            "publicationAttempts": [],
            "entries": [],
            "derived": {},
        },
        "human": {
            "observation": empty_observation("not_observed", []),
            "submissions": [],
            "intakeReviews": [],
            "judgments": [],
            "derived": {},
        },
        "reservations": {"observation": empty_observation("not_observed", []), "records": [], "derived": {}},
        "quarantine": {"observation": empty_observation("not_observed", []), "cases": [], "derived": {}},
        "effectiveState": {
            "determinability": "partially_determinate",
            "ai": {
                "published": {"occupancyState": "unknown", "currentRefs": [], "usabilityState": "unknown"},
                "candidate": {"occupancyState": "unknown", "currentRefs": [], "usabilityState": "unknown"},
                "selection": {
                    "layer": "unknown",
                    "conclusionRef": None,
                    "currentConclusionState": "unknown",
                    "failClosed": True,
                    "reasonCodes": ["EFFECTIVE.CURRENT_AI_NOT_OBSERVED"],
                },
                "assessmentHistoryState": "not_observed",
                "researchHistoryState": "not_observed",
            },
            "human": {
                "currentJudgmentRefs": [],
                "selectionEligibleRefs": [],
                "preferredJudgmentRef": None,
                "pluralityState": "unknown",
                "reasonCodes": ["HUMAN.NOT_OBSERVED"],
            },
            "comparison": {},
            "presentation": {},
            "search": {},
            "pipelineState": {"state": "needs_current_discovery_or_research"},
            "warnings": ["MIGRATION.CANONICAL_ONLY_NO_CURRENT_RATING"],
            "recommendedActions": ["RUN_CURRENT_DISCOVER_RESEARCH_ASSESSMENT"],
            "systemDefaultReference": {
                "basis": "no_current_conclusion",
                "sourceRef": None,
                "mode": None,
                "gradeProjection": None,
                "reasonCode": "EFFECTIVE.NO_CURRENT_AUTHORITY",
            },
        },
        "integrity": {
            "determinability": "partially_determinate",
            "checkSummary": {
                "migrationStructure": "pass",
                "currentResearch": "not_observed",
                "currentAssessment": "not_observed",
            },
            "issueRefs": [],
            "issueProjection": [],
            "derived": {},
        },
        "provenance": {
            "auditRunRef": AUDIT_RUN_ID,
            "outputRecordRef": f"formal-work-lineage-v01:work:{work_id}",
            "bindings": [
                {
                    "target": {"targetObjectRef": f"work:{work_id}", "fieldPath": "canonical"},
                    "lineageType": "migrated",
                    "lineageState": "complete",
                    "provenanceObservationRefs": [canonical_observation_id],
                },
                {
                    "target": {"targetObjectRef": f"work:{work_id}", "fieldPath": "identities"},
                    "lineageType": "migrated",
                    "lineageState": identity_state,
                    "provenanceObservationRefs": identity_refs,
                },
            ],
            "summary": {
                "packageId": PACKAGE_ID,
                "legacyRuntimeDependency": False,
                "legacyResearchImported": False,
                "legacyRatingImported": False,
            },
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--lock", type=Path, required=True)
    args = parser.parse_args()
    formal = args.out.resolve()
    formal.mkdir(parents=True)

    canonical_observation = observation("sealed_snapshot_canonical_workid_title_projection", 2, "1" * 64)
    identity_observation = observation("sealed_snapshot_exact_tuple_projection", 1, "2" * 64)
    observations = sorted([canonical_observation, identity_observation], key=lambda row: row["observationId"])
    rows = [
        make_row("100", "Fixture Bound Work", canonical_observation["observationId"], identity_observation["observationId"], True),
        make_row("101", "Fixture Partial Work", canonical_observation["observationId"], identity_observation["observationId"], False),
    ]
    write_jsonl(formal / "formal-work-lineage.jsonl", rows)
    write_jsonl(formal / "provenance-observations.jsonl", observations)

    outputs = []
    for output_ref, name in (
        ("formal-work-lineage", "formal-work-lineage.jsonl"),
        ("provenance-observations", "provenance-observations.jsonl"),
    ):
        payload = (formal / name).read_bytes()
        outputs.append({"outputRef": output_ref, "path": name, "sha256": sha256_bytes(payload), "bytes": len(payload), "rows": len(rows) if name.startswith("formal") else len(observations)})
    output_manifest = {
        "schemaVersion": "global-output-manifest-v01",
        "manifestId": OUTPUT_MANIFEST_ID,
        "canonicalizationProfileRef": "policies/provenance-canonicalization-profile-v01.json",
        "outputs": outputs,
    }
    output_manifest["manifestHash"] = content_hash(output_manifest)
    write_json(formal / "output-manifest.json", output_manifest)

    provenance_bundle = {
        "schemaVersion": "global-provenance-bundle-manifest-v01",
        "bundleId": PROVENANCE_BUNDLE_ID,
        "contractVersion": "global-work-lineage-v01",
        "canonicalizationProfileRef": "policies/provenance-canonicalization-profile-v01.json",
        "sourceSnapshots": [{"role": "test_fixture"}],
        "processingIdentities": [{"engineVersion": "test-fixture-v01"}],
        "configPolicyIdentities": [{"ref": "test-fixture-v01"}],
        "archivePolicyIdentity": {
            "formalPackageRuntimeIndependent": True,
            "referencePackageRuntimeReadable": False,
            "oldDatabaseRuntimeReadable": False,
        },
        "outputManifestHash": output_manifest["manifestHash"],
    }
    provenance_bundle["provenanceRootHash"] = content_hash(provenance_bundle)
    write_json(formal / "provenance-bundle.json", provenance_bundle)

    audit_run = {
        "schemaVersion": "global-audit-run-v01",
        "auditRunId": AUDIT_RUN_ID,
        "contractVersion": "global-work-lineage-v01",
        "state": "sealed",
        "startedAt": "2026-08-14T00:00:00Z",
        "sealedAt": "2026-08-14T00:00:00Z",
        "parentAuditRunRef": None,
        "sourceManifestRefs": ["test-fixture-v01"],
        "outputManifestRef": OUTPUT_MANIFEST_ID,
        "provenanceBundleManifestRef": PROVENANCE_BUNDLE_ID,
        "provenanceRootHash": provenance_bundle["provenanceRootHash"],
    }
    write_json(formal / "audit-run.json", audit_run)

    manifest = {
        "schemaVersion": "global-work-lineage-formal-import-package-manifest-v01",
        "packageId": PACKAGE_ID,
        "terminalOutcome": "FORMAL_IMPORT",
        "contractVersion": "global-work-lineage-v01",
        "legacyModuleMode": "retired",
        "counts": {
            "formalWorkLineageRows": 2,
            "formalIdentityBindings": 1,
            "legacyResearchRowsInFormalPackage": 0,
            "legacyRatingsInFormalPackage": 0,
        },
        "outputManifestHash": output_manifest["manifestHash"],
        "provenanceRootHash": provenance_bundle["provenanceRootHash"],
        "isolation": {
            "freshDatabaseRequired": True,
            "formalPackageSelfContained": True,
            "productionRuntimeLegacyDependencies": 0,
            "productionRuntimeReferenceDependencies": 0,
            "compatibilityBridges": 0,
            "dualReads": 0,
        },
    }
    write_json(formal / "manifest.json", manifest)

    members = sorted(path for path in formal.iterdir() if path.name != "SHA256SUMS")
    sums = "".join(f"{sha256_bytes(path.read_bytes())}  {path.name}\n" for path in members).encode("utf-8")
    (formal / "SHA256SUMS").write_bytes(sums)

    provenance_objects = [
        *(('observation', row["observationId"], row) for row in observations),
        ("audit_run", AUDIT_RUN_ID, audit_run),
        ("output_manifest", OUTPUT_MANIFEST_ID, output_manifest),
        ("provenance_bundle", PROVENANCE_BUNDLE_ID, provenance_bundle),
        ("formal_package_manifest", PACKAGE_ID, manifest),
    ]
    document_set = b"".join(
        f"{row['workId']}\t{sha256_bytes(canonical_json(row))}\n".encode("utf-8") for row in rows
    )
    provenance_set = b"".join(
        f"{object_ref}\t{sha256_bytes(canonical_json(document))}\n".encode("utf-8")
        for _, object_ref, document in sorted(provenance_objects, key=lambda item: item[1])
    )
    lock = {
        "schemaVersion": "global-work-lineage-fresh-database-import-lock-v01",
        "packageId": PACKAGE_ID,
        "contractVersion": "global-work-lineage-v01",
        "frozenBlockCount": 13,
        "legacyModuleMode": "retired",
        "formalPackage": {
            "sha256SumsSha256": sha256_bytes(sums),
            "outputManifestHash": output_manifest["manifestHash"],
            "provenanceRootHash": provenance_bundle["provenanceRootHash"],
            "documentSetSha256": sha256_bytes(document_set),
            "provenanceObjectSetSha256": sha256_bytes(provenance_set),
            "counts": {
                "formalWorkLineageRows": 2,
                "formalIdentityBindings": 1,
                "partialIdentityRows": 1,
                "provenanceObjects": len(provenance_objects),
            },
        },
        "target": {
            "databaseMustBeEmpty": True,
            "compatibilityBridges": 0,
            "legacyRuntimeDependencies": 0,
            "referenceRuntimeDependencies": 0,
        },
    }
    args.lock.parent.mkdir(parents=True, exist_ok=True)
    write_json(args.lock.resolve(), lock)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
