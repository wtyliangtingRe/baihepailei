# Radar Public Metrics production apply-once gate v01

## Current stage

This branch begins with a **candidate-acceptance lock only**.

It binds the accepted post-merge source-read-only Candidate, the accepted
disposable update-only rehearsal, the frozen Research Release, and the exact
merged website `main`:

`cba94510c6ed460f821d82179e24d9a61ee28f5c`

No production importer, marker, apply runner, production authorization or
database write is introduced in this first commit.

## Accepted inputs

- Research head: `c2fe7847ee8b60b439f8e92025437937ceff06d5`
- Release: `RADAR-PUBLIC-METRICS-10563-0001`
- post-merge Candidate SHA-256:
  `cc8757e41be8ef51e8331e9e19d59d9fadb2ad8e2ca1eba9e2a8357f7bdea6b7`
- post-merge independent-review ZIP SHA-256:
  `d044479131e8ce77f01901ea092970a2a72c69deecc3382cfbc625fca1c69d83`
- post-merge audit Markdown SHA-256:
  `88f84319459f9627f1296a3ba85f0ac51e7c4a71bb3a947a5e258d561454f9e3`
- post-merge audit JSON SHA-256:
  `b96b2f1561bc7cc5e465ac6a0e06f400f230da1dfb14b2a3857da18530f8d025`
- accepted disposable rehearsal ZIP SHA-256:
  `1474267b2d53ecf08209afb0eb2bf6f8d01c2fbdba9a1f5845b23f3f86b67b0f`

## Required implementation gates

Later commits on this same Draft PR must add and independently validate:

1. a production-specific nonce-bound loopback marker;
2. an update-only importer that preserves the already-reviewed exact eight-field
   PATCH body;
3. a fresh same-window source backup;
4. a full disposable restore rehearsal of the production gate;
5. writer isolation and source-container identity checks;
6. PostgreSQL advisory locking and a durable apply-control marker;
7. exact `plan -> apply -> verify` convergence;
8. failure receipts with no automatic retry or rollback;
9. a separate post-merge production-authorization artifact;
10. a typed operator confirmation immediately before the first source PATCH.

## Safety state

```text
source database write       false
Payload write               false
production metric import    false
production authorization    false
executable production gate  false
```

This Stage A commit cannot execute or authorize the production update.
