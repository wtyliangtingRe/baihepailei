# Kanamemo end-to-end website fixture v01

This fixture consumes one exact Discovery-backed Work from the research-data
repository and proves the final website database boundary on disposable
PostgreSQL.

## Exact subject

- Work ID: 15117
- site ID: catalog-anilist-5914
- provider identity: anilist | media | 5914
- source pull request: wtyliangtingRe/baihepailei-research-data#372
- release: formal-single-work-e2e-pilot-20260823-0001:fixture-release-v01

The source binding records the accepted research-data head and merge commits,
the bootstrap bytes, the final row bytes, the canonical document hashes, and
the exact delta bytes. The builder rejects any drift.

## Disposable database path

The CI job:

1. imports the existing tiny formal fixture into a fresh PostgreSQL database;
2. uses the insert-only provision writer to add Work 15117 and its immutable
   audit-run dependency;
3. confirms the bootstrap canonical document hash;
4. uses the existing-row writer to apply one exact document-sha256 CAS delta;
5. compares the JSONB readback with the complete final document;
6. confirms fixed D/D/D/D, both decisive RatingClasses, the exact warning, and
   false production authorization;
7. proves unrelated rows are byte-hash stable; and
8. proves duplicate provision and CAS replay both fail without changing state.

The repository contains no production database URL. Both gates are generated
ephemerally for the disposable CI database only.

## Capability boundary

Research, Assessment, Candidate, and Publication workers revise only their
authorized blocks. Therefore this fixture preserves the bootstrap
effectiveState unchanged and fail-closed. It verifies the durable Published
row and physical database handoff; it does not claim a production resolver or
public UI release.
