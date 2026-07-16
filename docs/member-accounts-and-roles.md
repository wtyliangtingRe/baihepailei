# Member accounts and staff roles

## Public account flow

- Register at `/account/register` with email, display name and password.
- New public registrations are always forced to `member` by a server hook.
- Email verification is required before login.
- Login and logout use Payload's HTTP-only auth cookie.
- Password recovery uses `/account/forgot-password` and a one-hour email reset token.
- `/account` links to personal lists, feedback, and staff tools when permitted.

Production must configure the SMTP variables in `.env.example`. Without a working email adapter, verification and password-reset mail cannot be delivered.

## Roles

| Value | Label | Capabilities |
| --- | --- | --- |
| `owner` | 最高领袖 | Full content, moderation, user and personnel control |
| `admin` | 管理员 | Content and moderation; may appoint `editor` or return one to `member` |
| `editor` | 编辑 | Edit and approve content; moderate comments and feedback |
| `member` | 注册用户 | Comment, manage private lists, submit feedback |

`reviewer` and `trusted` remain as compatibility roles for existing records. New appointments should use the four roles above.

## Owner bootstrap

The owner identity is explicit and deployment-specific:

```dotenv
SITE_OWNER_EMAIL=owner@example.com
```

For the official Baihepailei deployment, set it to `wty1123581321@gmail.com`. The server promotes that exact verified registration to `owner` and prevents it from being renamed or demoted through ordinary API updates.

Self-hosted copies must deliberately set their own owner email. There is no hidden cross-deployment account or universal fallback identity.

If the official email already exists as an older admin record, update that record once after setting `SITE_OWNER_EMAIL`; the user hook will normalize it to `owner`.

## Personnel boundaries

- Only `owner` can appoint or remove `admin`.
- `admin` may appoint `editor` and return an editor to `member`.
- `admin` cannot edit the configured owner account or another admin's credentials.
- `editor` cannot change roles.
- Public registration cannot choose a privileged role even if a forged `role` value is submitted.

## Content boundaries

- Editors may create, edit and publish Works.
- Only owner/admin may delete Works.
- Comments and feedback enter pending queues before publication or adoption.
- Accepting feedback never automatically changes a Work rating; a staff member must apply the verified result separately.
