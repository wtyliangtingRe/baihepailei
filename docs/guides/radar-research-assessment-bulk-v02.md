# Research-aware assessment handoff v0.2

This workflow is review-only. It reads a checksum-bound research review ZIP, creates recoverable assessment inputs, and later validates externally supplied assessment responses. It never reads or writes Payload or PostgreSQL, modifies Works, publishes ratings, or creates a production-apply package.

## Prepare from the accepted ZIP

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/radar/run-and-package-radar-research-assessment-bulk-v02.ps1 `
  -ResearchInput exports/RADAR-REMAINING-CANONICAL-RESEARCH-0001-ALL-WAVES-ASSEMBLED-REVIEW-v01.zip `
  -ExpectedSha256 E8D952F143A44FDC983E8D8FF76768DCEEF03FF4CBD8DA19D8FC45F9C3B0CE2F
```

The package-specific row, wave, chunk, and research-lane expectations are supplied by `scripts/radar/fixtures/radar-research-assessment-accepted-0001-v02.json`; they are not universal business rules.

Preparation verifies closed-world archive membership, safe paths, duplicates, links, canonical extraction confinement, every manifest byte count and SHA-256, wave summaries, research fields, unique identities, and exact source order. It writes immutable inputs, ten wave manifests, 100 chunk manifests/response paths, an external-response schema, aggregate input, and input review lanes. Response slots remain empty.

## Supply genuine responses

For every manifest `responseFile`, supply one ordered JSONL response per ordered input row. Each response must copy `workId`, `siteId`, `title`, `researchDisposition`, `identity`, `writeProtection`, `research`, `contentProfile`, `riskLabels`, `allowedAssessmentModes`, `requiresHumanReview`, `publicationEligible`, and `pageNotice` exactly. It then adds `assessmentMode`, `exactGradeSuggestion`, `gradeRange`, and `ruleAssessments`.

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

Assembly is a pure validator and merger. Missing, extra, duplicate, reordered, tampered, rewritten, unsafe, or synthetic responses prevent genuine completion. Only a blocker-free genuine response set creates standard per-wave assembled results, aggregate assembled output, and assembled review lanes.

Synthetic fixtures exist only in tests. `--synthetic-rehearsal` validates explicitly marked `syntheticRehearsal: true` responses into separate synthetic directories; summaries retain `synthetic_response_not_real_assessment`, `genuineAssessmentComplete=false`, and zero genuine assembled rows.