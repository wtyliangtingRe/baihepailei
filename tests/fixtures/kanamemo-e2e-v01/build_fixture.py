#!/usr/bin/env python3
"""Build exact, ephemeral gates for the Kanamemo website database fixture.

The committed bootstrap row and CAS delta are immutable research-data outputs.
This builder verifies their cross-repository binding and semantics, then emits
only disposable-test provision/apply gates. It never contains a production
database URL and never authorizes a production write.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
from types import ModuleType
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_ROOT = REPO_ROOT / "tests/fixtures/kanamemo-e2e-v01"
BINDING_PATH = FIXTURE_ROOT / "source-binding.v01.json"
BOOTSTRAP_PATH = FIXTURE_ROOT / "bootstrap-current-work-lineage.json"
DELTA_PATH = FIXTURE_ROOT / "work-lineage-delta.jsonl"

FIXTURE_ID = "kanamemo-e2e-website-fixture-20260823-0001"
WORK_ID = "15117"
SITE_ID = "catalog-anilist-5914"
PROVIDER_KEY = "anilist|media|5914"
RELEASE_REF = "formal-single-work-e2e-pilot-20260823-0001:fixture-release-v01"
RESEARCH_REPOSITORY = "wtyliangtingRe/baihepailei-research-data"
RESEARCH_PR = 372
RESEARCH_HEAD = "23fae2da1e7935ad8e1ba6da9c15b3ef891465a1"
WEBSITE_BASE = "ee2ddb1b7acdf6b0f581824b4778583925ce4bab"

BOOTSTRAP_FILE_SHA256 = "a17ea51e723e2e115621daa52adfca087c96c8d117143528c655f67dd95d4660"
BOOTSTRAP_DOCUMENT_SHA256 = "1f0eb1a8ed79d89aa4d6413dcedd8810826a47a6247bf7ff3c5ea6acbbadff79"
DELTA_RAW_SHA256 = "e9fb12675e137f5ddfe428a9a74da3038662ebd37757914e0c9508ab64ed99bb"
FINAL_ROW_FILE_SHA256 = "915771770f825a790ea4d93b1bbbff6bdb86af5524accfc5501eb3bf2253c5e8"
FINAL_DOCUMENT_SHA256 = "02f228ec11448e10bd229b0ea85ee8a19131b519ee444917e15b909546c4d906"
WARNING = "含成年人对 7—15 岁女孩的性化、骚扰与不当幻想描写。"
CLASSES = ["D-SIDE-YURI", "D-SIDE-SEVERE-RADAR"]
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


class FixtureError(ValueError):
    """An exact-binding or semantic fixture failure."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise FixtureError(message)


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
        raise FixtureError(f"value is not canonical JSON: {exc}") from exc


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def duplicate_safe_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(path: Path) -> dict[str, Any]:
    require(path.is_file(), f"missing JSON file: {path}")
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=duplicate_safe_object,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FixtureError(f"invalid JSON at {path}: {exc}") from exc
    require(isinstance(value, dict), f"expected JSON object at {path}")
    return value


def load_module(name: str, path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    require(spec is not None and spec.loader is not None, f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


PROVISION_TOOL = load_module(
    "kanamemo_fixture_provision_tool",
    REPO_ROOT / "scripts/work-lineage/provision_global_work_lineage_rows_v01.py",
)
DELTA_TOOL = load_module(
    "kanamemo_fixture_delta_tool",
    REPO_ROOT / "scripts/work-lineage/apply_global_work_lineage_delta_v01.py",
)


def validate_binding(binding: dict[str, Any]) -> None:
    require(
        set(binding)
        == {
            "schemaVersion",
            "fixtureId",
            "identity",
            "releaseRef",
            "researchData",
            "website",
        },
        "source binding root shape drift",
    )
    require(
        binding["schemaVersion"] == "kanamemo-e2e-website-fixture-binding-v01",
        "source binding schemaVersion drift",
    )
    require(binding["fixtureId"] == FIXTURE_ID, "fixtureId drift")
    require(
        binding["identity"]
        == {
            "workId": WORK_ID,
            "siteId": SITE_ID,
            "providerIdentityKey": PROVIDER_KEY,
        },
        "source binding exact identity drift",
    )
    require(binding["releaseRef"] == RELEASE_REF, "source binding releaseRef drift")

    research = binding["researchData"]
    require(
        set(research)
        == {
            "repository",
            "pullRequest",
            "headCommit",
            "mergeCommit",
            "executionRoot",
            "bootstrapPath",
            "bootstrapFileSha256",
            "bootstrapDocumentSha256",
            "deltaPath",
            "deltaRawSha256",
            "finalRowPath",
            "finalRowFileSha256",
            "finalDocumentSha256",
        },
        "researchData binding shape drift",
    )
    expected_research = {
        "repository": RESEARCH_REPOSITORY,
        "pullRequest": RESEARCH_PR,
        "headCommit": RESEARCH_HEAD,
        "executionRoot": "datasets/formal-e2e-pilot-20260823-0001/v01/execution",
        "bootstrapPath": (
            "datasets/formal-e2e-pilot-20260823-0001/v01/"
            "bootstrap/current-work-lineage.json"
        ),
        "bootstrapFileSha256": BOOTSTRAP_FILE_SHA256,
        "bootstrapDocumentSha256": BOOTSTRAP_DOCUMENT_SHA256,
        "deltaPath": (
            "datasets/formal-e2e-pilot-20260823-0001/v01/execution/stages/"
            "website_delta/artifacts/work-lineage-delta.jsonl"
        ),
        "deltaRawSha256": DELTA_RAW_SHA256,
        "finalRowPath": (
            "datasets/formal-e2e-pilot-20260823-0001/v01/execution/"
            "current/current-work-lineage.json"
        ),
        "finalRowFileSha256": FINAL_ROW_FILE_SHA256,
        "finalDocumentSha256": FINAL_DOCUMENT_SHA256,
    }
    for field, expected in expected_research.items():
        require(research.get(field) == expected, f"researchData {field} drift")
    merge_commit = research.get("mergeCommit")
    require(
        isinstance(merge_commit, str) and COMMIT_RE.fullmatch(merge_commit) is not None,
        "researchData mergeCommit is not an exact commit SHA",
    )
    require(merge_commit != RESEARCH_HEAD, "researchData mergeCommit was not recorded after merge")

    require(
        binding["website"]
        == {
            "repository": "wtyliangtingRe/baihepailei",
            "baseCommit": WEBSITE_BASE,
            "fixtureTarget": "disposable_postgresql_only",
            "fixtureApplyAuthorized": True,
            "productionWriteAuthorized": False,
        },
        "website authorization or base binding drift",
    )


def exact_identity(document: dict[str, Any]) -> None:
    require(document.get("workId") == WORK_ID, "Work ID drift")
    require(
        document.get("canonical", {}).get("naming", {}).get("canonicalTitle") == "Kanamemo",
        "canonical title drift",
    )
    matches = [
        item
        for item in document.get("identities", {}).get("bindings", [])
        if item.get("externalIdentity", {}).get("providerIdentityKey") == PROVIDER_KEY
        and item.get("bindingState") == "current"
        and item.get("verificationState") == "confirmed"
        and item.get("scopeMatch") == "exact"
    ]
    require(len(matches) == 1, "exact provider identity is not uniquely confirmed")
    external = matches[0]["externalIdentity"]
    require(
        external
        == {
            "provider": "anilist",
            "namespace": "media",
            "externalId": "5914",
            "providerIdentityKey": PROVIDER_KEY,
        },
        "external identity tuple drift",
    )


def validate_final_document(final: dict[str, Any], bootstrap: dict[str, Any]) -> None:
    exact_identity(final)
    require(
        final.get("research", {}).get("derived", {}).get("currentReadiness")
        == "ready_for_ai_assessment",
        "Research readiness drift",
    )
    assessment = final.get("assessment", {})
    current_attempt = assessment.get("derived", {}).get("currentAttemptId")
    attempts = [
        item for item in assessment.get("attempts", []) if item.get("attemptId") == current_attempt
    ]
    require(len(attempts) == 1, "current Assessment attempt is not unique")
    require(attempts[0].get("policyRef") == "radar-rating-policy-v0.5", "policy drift")
    require(attempts[0].get("validation", {}).get("productionAuthorization") is False,
            "Assessment authorizes production")
    decisions = attempts[0].get("decisions", [])
    require(len(decisions) == 1, "Assessment decision cardinality drift")
    decision = decisions[0]
    conclusion = decision.get("conclusion", {})
    require(conclusion.get("workId") == WORK_ID and conclusion.get("siteId") == SITE_ID,
            "Assessment conclusion identity drift")
    require(conclusion.get("conclusionMode") == "fixed_grade", "conclusion mode drift")
    require(
        [conclusion.get(field) for field in ("coreGrade", "bestGrade", "likelyGrade", "worstGrade")]
        == ["D", "D", "D", "D"],
        "fixed D invariant drift",
    )
    require(conclusion.get("supportedLabels") == [], "unsupported public warning tag emitted")
    matches = decision.get("ratingClassAnalysis", {}).get("matches", [])
    require([item.get("classId") for item in matches] == CLASSES, "RatingClass set drift")
    require(all(item.get("grade") == "D" and item.get("decisive") is True for item in matches),
            "RatingClass grade or decisive flag drift")
    require(decision.get("publicationEligibility") == "publishable_rating",
            "publication eligibility drift")

    candidate_refs = final.get("candidate", {}).get("derived", {}).get("currentCandidateRefs", [])
    candidates = [
        item for item in final.get("candidate", {}).get("records", [])
        if item.get("candidateId") in candidate_refs
    ]
    require(len(candidate_refs) == 1 and len(candidates) == 1, "Candidate selection drift")
    candidate = candidates[0]
    require(candidate.get("conclusions", {}).get("coreConclusion") == conclusion,
            "Candidate changed the Assessment conclusion")
    require(candidate.get("explanation", {}).get("displayTermRefs") == CLASSES,
            "Candidate changed the RatingClasses")
    require(candidate.get("explanation", {}).get("warnings") == [WARNING],
            "Candidate warning drift")

    published_refs = final.get("published", {}).get("derived", {}).get(
        "currentPublishedEntryRefs", []
    )
    entries = [
        item for item in final.get("published", {}).get("entries", [])
        if item.get("publishedEntryId") in published_refs
    ]
    require(len(published_refs) == 1 and len(entries) == 1, "Published selection drift")
    entry = entries[0]
    require(entry.get("sourceCandidateRef") == candidate.get("candidateId"),
            "Published Candidate ref drift")
    require(entry.get("publicConclusion") == conclusion,
            "Published changed the Candidate conclusion")
    require(entry.get("releaseRef") == RELEASE_REF, "Published releaseRef drift")
    require(entry.get("publicExplanation", {}).get("warnings") == [WARNING],
            "Published warning drift")
    publication_attempts = final.get("published", {}).get("publicationAttempts", [])
    require(publication_attempts, "Publication attempt is missing")
    require(all(item.get("productionWriteAuthorized") is False for item in publication_attempts),
            "Publication attempt authorizes production")

    reservations = final.get("reservations", {})
    require(reservations.get("derived", {}).get("activeReservationIds") == [],
            "active reservation remains")
    require(
        len(reservations.get("records", [])) == 4
        and all(item.get("state") == "released" for item in reservations["records"]),
        "revision-stage reservation release drift",
    )
    require(
        final.get("effectiveState") == bootstrap.get("effectiveState"),
        "effectiveState was mutated outside the revision-stage worker capabilities",
    )


def validate_fixture(
    binding_path: Path = BINDING_PATH,
    bootstrap_path: Path = BOOTSTRAP_PATH,
    delta_path: Path = DELTA_PATH,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], Any]:
    binding = load_json(binding_path)
    validate_binding(binding)

    bootstrap_raw = bootstrap_path.read_bytes()
    require(sha256_bytes(bootstrap_raw) == BOOTSTRAP_FILE_SHA256,
            "bootstrap pretty-file SHA-256 drift")
    bootstrap = load_json(bootstrap_path)
    require(sha256_bytes(canonical_json(bootstrap)) == BOOTSTRAP_DOCUMENT_SHA256,
            "bootstrap canonical-document SHA-256 drift")
    exact_identity(bootstrap)

    delta_raw = delta_path.read_bytes()
    require(sha256_bytes(delta_raw) == DELTA_RAW_SHA256, "delta raw SHA-256 drift")
    parsed_delta = DELTA_TOOL.load_delta(delta_path)
    require(len(parsed_delta.rows) == 1, "delta row cardinality drift")
    record = load_json(delta_path)
    require(record.get("schemaVersion") == "global-work-lineage-delta-row-v01",
            "delta row contract drift")
    require(record.get("workId") == WORK_ID, "delta Work ID drift")
    require(record.get("baseDocumentSha256") == BOOTSTRAP_DOCUMENT_SHA256,
            "delta base document binding drift")
    final = record.get("document")
    require(isinstance(final, dict), "delta final document is missing")
    require(sha256_bytes(canonical_json(final)) == FINAL_DOCUMENT_SHA256,
            "final canonical-document SHA-256 drift")
    validate_final_document(final, bootstrap)
    return binding, bootstrap, record, parsed_delta


def write_pretty_json(path: Path, value: Any) -> None:
    path.write_bytes(
        (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2) + "\n")
        .encode("utf-8")
    )


def build(out_dir: Path, *, binding_path: Path = BINDING_PATH) -> dict[str, Any]:
    require(not out_dir.exists(), f"output path already exists: {out_dir}")
    binding, bootstrap, _, parsed_delta = validate_fixture(binding_path)
    out_dir.mkdir(parents=True)

    audit_ref = bootstrap.get("provenance", {}).get("auditRunRef")
    require(isinstance(audit_ref, str) and audit_ref != "", "bootstrap auditRunRef is missing")
    audit_document = {
        "schemaVersion": "global-audit-run-v01",
        "auditRunId": audit_ref,
        "state": "sealed",
        "fixtureId": FIXTURE_ID,
        "fixturePurpose": "disposable PostgreSQL bootstrap seed only",
        "source": {
            "repository": RESEARCH_REPOSITORY,
            "pullRequest": RESEARCH_PR,
            "headCommit": RESEARCH_HEAD,
            "mergeCommit": binding["researchData"]["mergeCommit"],
        },
        "productionWriteAuthorized": False,
    }
    package = {
        "schemaVersion": "global-work-lineage-provision-package-v01",
        "existingProvenanceRefs": [],
        "provenanceObjects": [
            {
                "objectRef": audit_ref,
                "objectKind": "audit_run",
                "document": audit_document,
            }
        ],
        "works": [{"workId": WORK_ID, "document": bootstrap}],
    }
    package_path = out_dir / "provision-package.json"
    package_path.write_bytes(canonical_json(package) + b"\n")
    parsed_package = PROVISION_TOOL.load_package(package_path)

    provision_gate = {
        "schemaVersion": "global-work-lineage-provision-apply-gate-v01",
        "applyEnabled": True,
        "releaseRef": RELEASE_REF,
        "packageSha256": parsed_package.raw_sha256,
        "provenanceSetSha256": parsed_package.provenance_set_sha256,
        "workSetSha256": parsed_package.work_set_sha256,
        "provenanceObjectCount": len(parsed_package.provenance_objects),
        "workCount": len(parsed_package.works),
    }
    delta_gate = {
        "schemaVersion": "global-work-lineage-delta-apply-gate-v01",
        "applyEnabled": True,
        "releaseRef": RELEASE_REF,
        "deltaSha256": parsed_delta.raw_sha256,
        "baseSetSha256": parsed_delta.base_set_sha256,
        "rowCount": len(parsed_delta.rows),
    }
    write_pretty_json(out_dir / "provision-gate.json", provision_gate)
    write_pretty_json(out_dir / "delta-gate.json", delta_gate)
    PROVISION_TOOL.validate_gate_binding(
        PROVISION_TOOL.load_gate(out_dir / "provision-gate.json"),
        parsed_package,
        RELEASE_REF,
    )
    DELTA_TOOL.validate_gate_binding(
        DELTA_TOOL.load_gate(out_dir / "delta-gate.json"),
        parsed_delta,
        RELEASE_REF,
    )

    summary = {
        "schemaVersion": "kanamemo-e2e-website-fixture-summary-v01",
        "status": "PASS_READY_FOR_DISPOSABLE_POSTGRESQL",
        "fixtureId": FIXTURE_ID,
        "identity": {
            "workId": WORK_ID,
            "siteId": SITE_ID,
            "providerIdentityKey": PROVIDER_KEY,
        },
        "source": {
            "researchRepository": RESEARCH_REPOSITORY,
            "researchPullRequest": RESEARCH_PR,
            "researchHeadCommit": RESEARCH_HEAD,
            "researchMergeCommit": binding["researchData"]["mergeCommit"],
        },
        "releaseRef": RELEASE_REF,
        "bootstrapDocumentSha256": BOOTSTRAP_DOCUMENT_SHA256,
        "finalDocumentSha256": FINAL_DOCUMENT_SHA256,
        "deltaRawSha256": DELTA_RAW_SHA256,
        "conclusion": {
            "mode": "fixed_grade",
            "grades": {"core": "D", "best": "D", "likely": "D", "worst": "D"},
            "classes": CLASSES,
            "warning": WARNING,
        },
        "effectiveStateHandling": "preserved_bootstrap_fail_closed",
        "fixtureApplyAuthorized": True,
        "productionWriteAuthorized": False,
    }
    write_pretty_json(out_dir / "verification-summary.json", summary)
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--binding", type=Path, default=BINDING_PATH)
    args = parser.parse_args()
    try:
        summary = build(args.out.resolve(), binding_path=args.binding.resolve())
    except (FixtureError, OSError, ValueError) as exc:
        print(f"KANAMEMO E2E WEBSITE FIXTURE: FAIL: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
