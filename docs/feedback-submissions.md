# Feedback submissions

The current public release uses moderated, authenticated GitHub Issue Forms for corrections and new-work suggestions. It does not expose a first-party anonymous database-write endpoint.

## Public flow

1. A reader opens `/feedback`, optionally from a work page carrying `workId` and `title`.
2. The page opens the matching GitHub Issue Form and pre-fills the known work identity.
3. The submitter describes the proposed correction and supplies verifiable source URLs.
4. Maintainers verify the work identity, edition, route, source and spoiler scope.
5. Accepted information is applied through the repository's normal reviewed data workflow.

Issue creation never updates `Works`, publication state, Radar assessment fields or ratings by itself.

## Access boundary

GitHub requires the submitter to have read access to the destination repository. The default destination is currently the private source repository and therefore supports collaborators only. A public deployment should set `NEXT_PUBLIC_FEEDBACK_ISSUE_URL` to a dedicated public issues-only repository that contains compatible `work-correction.yml` and `new-work.yml` forms.

The former Payload member submission queue and its authenticated UI are historical architecture and are not shipped by the current release tree. Historical additive migrations remain in the repository for auditability; they do not make a live endpoint available.

## Anonymous intake

Do not restore anonymous direct writes by only removing an authentication check. A separate anonymous intake service needs server-verified anti-automation, rate and body-size limits, strict schema validation, an isolated moderation queue, safe rendering, audit logs and an emergency disable switch. See `docs/deployment-profiles-and-feedback.md` for the full deployment boundary.
