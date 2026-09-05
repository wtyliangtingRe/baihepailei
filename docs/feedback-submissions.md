# Feedback submissions

The current release uses moderated, authenticated GitHub Issue Forms for corrections and new-work suggestions. Because the destination repository is private, this current path is collaborator-only. It does not expose a first-party anonymous database-write endpoint.

## Accepted public target (2026-09-05)

Future public intake has two parallel channels:

1. Ordinary visitors use an anonymous, text-only Cloudflare form with no attachment capability.
2. Contributors familiar with GitHub use Issue Forms in a dedicated public intake repository.

Neither channel requires a Baihepailei account. Neither channel may write to the core database or formal research records. This is an accepted architecture direction, not a claim that both public services are already live. See [`public-feedback-intake-decision-20260905.md`](public-feedback-intake-decision-20260905.md) for the durable decision record.

## Current GitHub flow

1. A reader opens `/feedback`, optionally from a work page carrying `workId` and `title`.
2. The page opens the matching GitHub Issue Form and pre-fills the known work identity.
3. The submitter describes the proposed correction and supplies verifiable source URLs.
4. Maintainers verify the work identity, edition, route, source and spoiler scope.
5. Accepted information is applied through the repository's normal reviewed data workflow.

Issue creation never updates `Works`, publication state, Radar assessment fields or ratings by itself.

## Future anonymous flow

1. A reader opens the same `/feedback` page and chooses the ordinary-visitor form.
2. The browser submits a small, schema-bound text request to a separate Cloudflare endpoint.
3. The edge service applies cheap preflight checks, rate limits and server-side Turnstile verification.
4. A valid, non-duplicate item enters an isolated pending queue subject to a global write ceiling.
5. Maintainers review it and promote accepted facts through a reviewed patch or pull request.

The anonymous request does not reach the AWS origin, fetch submitted URLs, upload files, invoke expensive processing or send automatic receipt email.

## Access boundary

GitHub requires the submitter to have read access to the destination repository. The default destination is currently the private source repository and therefore supports collaborators only. A public deployment should set `NEXT_PUBLIC_FEEDBACK_ISSUE_URL` to a dedicated public issues-only repository that contains compatible `work-correction.yml` and `new-work.yml` forms. The public intake repository must not contain application source, research data, credentials or restricted evidence.

The former Payload member submission queue and its authenticated UI are historical architecture and are not shipped by the current release tree. Historical additive migrations remain in the repository for auditability; they do not make a live endpoint available.

## Anonymous intake

Do not restore anonymous direct writes by only removing an authentication check. The accepted anonymous channel must terminate on a separate Cloudflare service rather than the AWS website origin. It is text-only and must not expose attachment or presigned-upload endpoints.

Before any pending item is stored, the service needs cheap request preflight checks, server-verified anti-automation, rate and body-size limits, strict schema validation, duplicate suppression and a global write ceiling that fails closed. It writes only to an isolated moderation queue using separate credentials. It must not possess core database credentials, fetch submitted URLs during the request, send automatic receipt email, or invoke expensive processing. See `docs/deployment-profiles-and-feedback.md` for the full deployment boundary.
