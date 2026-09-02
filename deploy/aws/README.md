# AWS deployment handoff

This release is a self-contained, read-only Next.js standalone application. The
versioned public snapshot is baked into the image; the research repository and
an external database are not runtime dependencies.

## Required server boundary

- Ubuntu 24.04 or another supported Docker host
- Docker Engine with Docker Compose v2
- an existing TLS reverse proxy for the final domain
- inbound public access limited to the proxy's HTTP/HTTPS ports
- application upstream kept on `127.0.0.1:3000` by default

Do not attach or restore the retired Baihepailei database, migration package, or
legacy runtime. This release starts from its bundled immutable snapshot.

## First deployment

Check out the exact approved website merge commit, then create a local `.env`
that is not committed:

```dotenv
NEXT_PUBLIC_SERVER_URL=https://example.com
SITE_OWNER_EMAIL=owner@example.com
BAIHEPAILEI_PORT=3000
NEXT_PUBLIC_MEDIA_MODE=enhanced
NEXT_PUBLIC_FEEDBACK_EMAIL=
NEXT_PUBLIC_FEEDBACK_FORM_URL=
NEXT_PUBLIC_FEEDBACK_ISSUE_URL=
```

Build and start the pinned source tree:

```bash
docker compose build --pull
docker compose up --detach --remove-orphans
docker compose ps
curl --fail --silent --show-error http://127.0.0.1:3000/api/health
```

The expected health payload contains:

```json
{"ok":true,"releaseId":"baihepailei-initial-site-release-20260902-v01","catalogWorks":35411,"ratedWorks":4001}
```

Point the existing TLS proxy upstream to
`http://127.0.0.1:${BAIHEPAILEI_PORT:-3000}`. Do not open the application port
in the AWS security group.

## Update and rollback

For an update, check out the newly approved commit and run the same build and
`up` commands. Docker Compose replaces the application only after the new image
has built successfully.

For rollback, check out the previous approved website merge commit and repeat
the build, start, and health-check commands. The bundled snapshot makes the
application rollback independent from database state.
