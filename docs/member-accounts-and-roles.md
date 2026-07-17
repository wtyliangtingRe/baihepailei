# Member accounts and staff roles

## Public account flow

- Register at `/account/register` with email, display name and password.
- New public registrations are always forced to `member` by a server hook.
- Production requires email verification before login; local development may explicitly disable it.
- Login and logout use Payload's official Next server functions and HTTP-only auth cookie.
- Password recovery uses `/account/forgot-password` and a one-hour email reset token.
- `/account` links to personal lists, feedback, and staff tools when permitted.

For local development, use `ACCOUNT_EMAIL_VERIFICATION_ENABLED=false` and leave `SMTP_HOST` blank. Production must set `ACCOUNT_EMAIL_VERIFICATION_ENABLED=true` and configure real SMTP; without a working email adapter, verification and password-reset mail cannot be delivered.

## Roles

| Value | Label | Capabilities |
| --- | --- | --- |
| `owner` | 最高领袖 | Full content, feedback review, user suspension and personnel control |
| `admin` | 管理员 | Content and feedback review; may appoint `editor`, return one to `member`, and suspend non-admin accounts |
| `editor` | 编辑 | Edit and approve content, review feedback, and delete inappropriate comments |
| `member` | 注册用户 | Publish comments, delete their own comments, manage private lists and submit feedback |

`reviewer` and `trusted` remain as compatibility roles for existing records. New appointments should use the four roles above.

## Owner bootstrap

The owner identity is explicit and deployment-specific:

```dotenv
SITE_OWNER_EMAIL=owner@example.com
```

For the official Baihepailei deployment, set it to `wty1123581321@gmail.com`. The server promotes that exact verified registration to `owner` and prevents it from being renamed or demoted through ordinary API updates.

Self-hosted copies must deliberately set their own owner email. There is no hidden cross-deployment account or universal fallback identity.

If the configured email already exists as an older admin or member record, its next successful password login normalizes it to `owner`. When email verification is enabled, the same successful login also normalizes a legacy owner record whose old `_verified` value is missing; this prevents the misleading state where password verification succeeds but the following authenticated request is rejected. This bootstrap only uses the deployment's explicit `SITE_OWNER_EMAIL` value.

## Personnel boundaries

- Only `owner` can appoint or remove `admin`.
- `admin` may appoint `editor` and return an editor to `member`.
- `admin` cannot edit the configured owner account or another admin's credentials.
- `editor` cannot change roles.
- Public registration cannot choose a privileged role even if a forged `role` value is submitted.

## Personnel and account suspension

`/me/personnel` is the first-party personnel console for `owner` and `admin` accounts.

- The owner may appoint or remove administrators and editors, and may suspend any non-owner account.
- Administrators may appoint editors or return them to members. They may suspend editors, members and compatibility-role accounts, but cannot modify the owner or another administrator.
- No staff member can suspend their own currently authenticated account from this console.
- Suspension uses the independent `accountStatus` field rather than Payload's temporary failed-login lock. Entering the suspended state clears all existing sessions immediately.
- A suspended account is redirected to `/account/locked` after a successful password check and cannot use authenticated community features.

## Content boundaries

- Editors may create, edit and publish Works.
- Only owner/admin may delete Works.
- Comments publish immediately. Authors can delete their own comments; editors and above can delete any comment.
- Feedback enters a pending evidence queue before adoption.
- Accepting feedback never automatically changes a Work rating; a staff member must apply the verified result separately.

## Local user cleanup

For a local test database, `scripts/users/prune-users-except-email.mjs` can remove every account except one explicitly retained owner. It is dry-run by default, requires the retained record to have role `owner`, and inventories dependent comments, lists, feedback and Work reviewer links before any deletion.

The script first checks `/api/users/me` and prints the authenticated identity. If password login succeeds but that check fails, confirm that `.env` contains the exact `SITE_OWNER_EMAIL`, pull the latest `main`, and restart the development server before retrying.

Always create and verify a database checkpoint before apply. The apply mode deletes list rows, comments and submitted feedback belonging to removed users; it clears reviewer references that should be preserved, then deletes the user records through Payload. It never writes PostgreSQL directly.

```powershell
$env:USER_MAINTENANCE_EMAIL="the retained owner email"
$env:USER_MAINTENANCE_PASSWORD="the retained owner's password"

# Read-only inventory first.
node scripts\users\prune-users-except-email.mjs `
  --url "http://localhost:3000" `
  --keep-email "the retained owner email"

# Only after reviewing the plan and creating a database checkpoint.
node scripts\users\prune-users-except-email.mjs `
  --url "http://localhost:3000" `
  --keep-email "the retained owner email" `
  --apply `
  --confirm "DELETE-USERS-EXCEPT-KEEP-EMAIL"
```
