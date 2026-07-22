# Wave 5 High-Impact A122 Input v01

This flow installs every previous-A row from the verified Wave 5 high-impact 230 package after the S/F extremes batch was completed.

## Fixed package

```text
RADAR-WAVE5-HIGH-IMPACT-A122-input-v01.zip
SHA-256: 903b7eed21748634600394143792fd6b76ed581ae508a4a9f708c0fe7d6469cb
```

## Fixed counts

```text
Rows: 122
Chunks: 25
Full chunks: 24 × 5
Final chunk: 2
```

## Previous rule distribution

```text
A-NEAR-CONFIRMED: 81
A-ONGOING: 29
A-OPEN-END: 2
A-YURI-HAREM: 11
```

One row carries two previous A rules, so rule occurrences total 123.

## Risk ordering

```text
Critical: 7
High: 37
Medium: 57
Standard: 21
```

The package places inherited route conflicts, unresolved open endings, ongoing works, low evidence coverage, low confidence, male or heterosexual risk terms, and single-secondary-only support first. The audit is designed to find over-rated A rows rather than assume every previous A should be retained.

## Source chain

```text
High-impact input ZIP:
323229c0d293c030ff4459a618690773663f576ddb49b05381939501b45a22b3

High-impact input checkpoint:
60aeee09bc022fdbb06635a5aa496f93d786832fd05eecdf6b48b3c71a7d19eb

Completed extremes-9 result ZIP:
9cc0c9df244135538547582558e70db82afbea3ee221374272c2e2d1a64cc578

Completed extremes-9 checkpoint:
73eb281e548b8322c0692615dd4bceb538c9c558d73ef9c27fe19bf691d1579f

Policy commit:
2719fe917f4e162590b19c1b0cc883eb08ee511d
```

## Run

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ".\scripts\radar\run-ai-radar-wave5-high-impact-a122-start-v01.ps1"
```

## Safety

- No Payload write.
- No direct PostgreSQL write.
- No Works mutation.
- No rating publication.
- No human-review-track mutation.
- Every task remains `do_not_publish` and requires human review.
