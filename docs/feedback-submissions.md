# Feedback submissions

`feedback-submissions` is the internal queue for member corrections and human Radar evidence.

Members can submit:

- target work or page;
- proposed S–X grade;
- proposed rule codes;
- the claim that should be checked;
- evidence summary and source URLs;
- spoiler status.

Every new row is stamped with the authenticated submitter and forced to `pending`. Editors, reviewers, admins and the owner can triage, accept, reject or request more information in Payload Admin.

Submission does not update `Works.rank`, `reviewStatus`, publication state or Radar fields. A reviewer must verify and apply accepted material separately.
