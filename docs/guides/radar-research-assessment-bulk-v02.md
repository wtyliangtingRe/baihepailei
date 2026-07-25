# Research-aware assessment handoff v0.2

This workflow is review-only. It reads a checksum-bound research review ZIP, creates recoverable assessment inputs, and later validates externally supplied assessment responses. It never reads or writes Payload or PostgreSQL, modifies Works, publishes ratings, or creates a production-apply package.

## Prepare from the accepted ZIP

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/radar/run-and-package-radar-research-assessment-bulk-v02.ps1 `
  -ResearchInput exports/RADAR-REMAINING-CANONICAL-RESEARCH-0001-ALL-WAVES-ASSEMBLED-REVIEW-v01.zip `
  -ExpectedSha256 E8D952F143A44FDC983E8D8FF76768DCEEF03FF4CBD8DA19D8FC45F9C3B0CE2F
```

The package-specific row, wave, chunk, and research-lane expectations are supplied by `scripts/radar/fixtures/radar-research-assessment-accepted-0001-v02.json`; they are not universal business rules.

Preparation verifies closed-world archive membership, safe paths, duplicates, links, canonical extraction confinement, and every `review-manifest.json` byte count and SHA-256. For every Wave it loads the source JSONL, the 50 response files declared by `handoff-manifest.json`, and the assembled research JSONL; verifies response membership, count, hash, expected identities, and order; and proves source → response → assembled identity/order plus exact response-field preservation. The accepted package proves 2,500 source rows, 2,500 research-response rows, 2,500 assembled research rows, and 500 verified research-response files with zero mismatches.

The acceptance binding explicitly requires non-empty `sourceSummary`, `contentSummary`, `relationshipSummary`, and `endingSummary`; typed `sources`, `unresolvedQuestions`, and `researchNotes` arrays with package-specific minimum cardinalities; and all six required `riskFindings` keys. For this accepted package `sources` and `researchNotes` require at least one item. `unresolvedQuestions` is required but may be empty because 656 accepted rows have no unresolved question. Missing data is rejected and is never normalized to an empty string or missing-object fallback.

Preparation writes immutable inputs, ten Wave manifests, 100 assessment chunk/response paths, an external-response schema, aggregate input, and input review lanes. It then writes `immutable-root-manifest-v02.json` and a one-entry immutable `SHA256SUMS` receipt. The root anchors `package-manifest.json`, every Wave manifest, immutable and chunk input, schema, instructions, aggregate input, and input review lane while deliberately excluding external assessment responses and later assembly outputs. The accepted research ZIP outer SHA is retained in both package evidence and the immutable root. Response slots remain empty.

## Supply genuine responses

For every manifest `responseFile`, supply one ordered JSONL response per ordered input row. Each response must copy `workId`, `siteId`, `title`, `researchDisposition`, `identity`, `writeProtection`, `research`, `contentProfile`, `riskLabels`, `allowedAssessmentModes`, `requiresHumanReview`, `publicationEligible`, and `pageNotice` exactly. It then adds `assessmentMode`, `exactGradeSuggestion`, `gradeRange`, and `ruleAssessments`.

The generated `response-schema-v02.json` exposes those same 13 input-owned fields and only those four assessment-outcome fields as required contract lists.

The disposition contract is:

- `ready_for_ai_assessment`: `exact` or `bounded_range`;
- `needs_more_research`: `bounded_range` or `labels_only`;
- `identity_review`: `labels_only`.

X is human-only and rejected in exact suggestions and ranges. All responses require human review, remain publication-ineligible, and use “AI 综合，待复核”.

## Assemble

```powershell
node scripts/radar/assemble-radar-research-assessment-bulk-v02.mjs `
  --package-dir data_local/outputs/ai-radar/research-assessment-v02
```

Assembly is a pure validator and merger. It verifies the immutable root receipt before trusting `package-manifest.json`, then enforces a closed-world external response inventory: only the exact paths declared by the Wave manifests may exist. Missing, extra, duplicate, misplaced, reordered, tampered, rewritten, unsafe, or invalid responses are structural blockers.

Each Wave is structurally evaluated and recovered independently. A blocker-free Wave writes its own assembled JSONL and summary even when another Wave is incomplete or invalid. The root aggregate and aggregate review lanes are written only when all Waves are structurally complete. Root summaries report completed, incomplete, and invalid Wave counts plus `technicallyAssembledRows`.

Each Wave summary reports only that Wave's `identityOrderMismatches`; the root summary retains the package-wide aggregate.

Technical assembly and release review are separate. `structuralBlockers` control technical completeness. `reviewOrReleaseBlockers` retain human/release requirements without suppressing technically valid results. Every `identity_review` assembled row carries `identity_resolution_required:<workId>`; `needs_more_research` rows carry their corresponding review blocker. All rows and summaries keep `releaseEligible=false` and `normalPublicationGatePass=false`.

Synthetic fixtures exist only in tests. `--synthetic-rehearsal` validates explicitly marked `syntheticRehearsal: true` responses into separate synthetic directories; summaries retain `synthetic_response_not_real_assessment`, `genuineAssessmentComplete=false`, and zero genuine assembled rows.

## Output paths and safety

Node-generated package and assembly data is restricted to `data_local`. The PowerShell wrapper separately restricts prepared and assembled review ZIPs to `exports`; callers cannot redirect either class of output arbitrarily. Manifests, summaries, and wrapper results report:

- `generatedDataConfinedToDataLocal=true`;
- `reviewArtifactsWrittenUnderExports=true`;
- `arbitraryOutputPathsAllowed=false`.

The workflow does not read or write Payload or PostgreSQL, modify Works, publish ratings, create a production apply package, or authorize production application.
