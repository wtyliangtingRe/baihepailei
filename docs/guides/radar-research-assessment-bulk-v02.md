# Research-aware assessment handoff v0.2

Run the review-only wrapper with a verified research ZIP. It verifies ZIP entry paths, manifest hashes, ten 250-row waves, source-to-assembled order, unique identities, and the accepted disposition counts before writing a 10 × 25 review package under `data_local`.

The package preserves research facts as input-owned and separates `ready_for_ai_assessment`, `needs_more_research`, and `identity_review`. All user-facing language is “AI 综合，待复核”. No Payload, PostgreSQL, Works, publication, or production-apply path is used.
