# Radar research assessment import v0.2

Issue #318 adds a guarded local importer and website-representation dry-run for a completed research-assessment v0.2 package. It does not import into the website. It creates no Payload request, SQL statement, Works mutation, rating publication, migration, schema push, or production apply artifact.

## Accepted package

Package-specific acceptance data lives in:

`scripts/radar/fixtures/radar-research-assessment-import-accepted-0001-v02.json`

The first accepted package is:

- assembled ZIP: `RADAR-REMAINING-CANONICAL-ASSESSMENT-0001-assembled-v02-review.zip`
- outer SHA-256: `42EF95EBDB883ADF0026635F178EAA07743D8404862475C91A6D4AD7D1BD63BB`
- Waves: 10
- input / response / assembled rows: 2,500 / 2,500 / 2,500
- exact / bounded range / labels only: 22 / 941 / 1,537
- ready / needs-more-research / identity-review: 962 / 1,311 / 227

These values are acceptance evidence for this package, not universal business rules in the reusable library.

## Validation boundary

No row is accepted until the importer has:

1. matched the required outer ZIP SHA-256;
2. rejected absolute paths, traversal, duplicate entries, symlinks, and extraction escapes;
3. extracted only below `data_local/staging`;
4. verified `SHA256SUMS`, `immutable-root-manifest-v02.json`, `package-manifest.json`, every Wave manifest, every immutable Wave and chunk input, and the immutable aggregate input;
5. verified the closed response inventory and every response SHA recorded by the assembly summary;
6. required all Waves to be genuinely complete, with no structural blockers;
7. verified exact input → response → assembled identity and order;
8. verified all 13 input-owned fields are byte-for-JSON unchanged in the response and assembled row;
9. required 2,500 input, response, and assembled rows;
10. rejected automatic X grades and any opened release or publication gate.

The 13 input-owned fields are:

`workId`, `siteId`, `title`, `researchDisposition`, `identity`, `writeProtection`, `research`, `contentProfile`, `riskLabels`, `allowedAssessmentModes`, `requiresHumanReview`, `publicationEligible`, and `pageNotice`.

Research and content evidence is copied without rewriting. Sexual content, participants, violence or horror, age or consent risk, coercion, TS, futa, ABO, crossdressing or otokonoko, NTR, and male involvement remain separate dimensions. Adult or explicit evidence is factual metadata; the importer does not grade it.

## Local review representation

The importer deliberately retains three different outcome shapes:

- `exact` has `provisionalExactSuggestion`;
- `bounded_range` has `boundedRange.best`, `.likely`, and `.worst`;
- `labels_only` has `insufficientCertainty`, `riskLabels`, and `ruleAssessments`.

Bounded-range and labels-only rows never receive `finalGrade`. Identity-review rows remain a separate `identity_unresolved` website-plan representation.

Every imported row remains:

- `requiresHumanReview: true`
- `publicationEligible: false`
- `releaseEligible: false`
- `normalPublicationGatePass: false`
- `pageNotice: "AI 综合，待复核"`

## Commands

Run the importer:

```powershell
node scripts/radar/import-radar-research-assessment-v02.mjs `
  --input 'C:\Users\10029\Downloads\RADAR-REMAINING-CANONICAL-ASSESSMENT-0001-assembled-v02-review.zip' `
  --expected-sha256 '42EF95EBDB883ADF0026635F178EAA07743D8404862475C91A6D4AD7D1BD63BB'
```

Generate the website-representation dry-run from the imported rows:

```powershell
node scripts/radar/plan-radar-research-assessment-v02-dryrun.mjs
```

Run both steps and create an optional review ZIP under `exports`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/radar/run-and-package-radar-research-assessment-import-v02.ps1 `
  -InputZip 'C:\Users\10029\Downloads\RADAR-REMAINING-CANONICAL-ASSESSMENT-0001-assembled-v02-review.zip' `
  -ExpectedSha256 '42EF95EBDB883ADF0026635F178EAA07743D8404862475C91A6D4AD7D1BD63BB'
```

The scripts reject `--execute`, `--apply`, `--write`, `--patch`, `--confirm`, `--gate`, `--approval-token`, `--production-apply`, and `--publish`.

## Outputs

Generated data is confined to:

`data_local/outputs/ai-radar/research-assessment-import-v02`

It contains:

- all imported review rows;
- exact, bounded-range, and labels-only rows;
- ready, needs-more-research, and identity-review lanes;
- severe E/F rule, male-involvement, NTR, TS, futa, ABO, and crossdressing/otokonoko review rows;
- one import summary per Wave;
- aggregate summary and blocker/warning index;
- human-readable CSV review index;
- dry-run website representation records and summary;
- `SHA256SUMS`.

The optional review artifact is:

`exports/RADAR-REMAINING-CANONICAL-ASSESSMENT-0001-import-v02-review.zip`

The review ZIP is not an apply package.

## Safety model

The committed summaries report:

- `networkFetch=false`
- `payloadRead=false`
- `payloadWrite=false`
- `payloadPatchRequests=0`
- `directPostgresqlRead=false`
- `directPostgresqlWrite=false`
- `postgresqlStatements=0`
- `modifiesWorks=false`
- `worksMutations=0`
- `publishesRatings=false`
- `publicationActions=0`
- `productionApplyAuthorized=false`
- `createsProductionApplyPackage=false`
- `migrationOrSchemaPush=false`
- `automaticXAllowed=false`
- `generatedDataConfinedToDataLocal=true`
- `reviewArtifactsWrittenUnderExports=true`
- `arbitraryOutputPathsAllowed=false`
- `dryRunOnly=true`
