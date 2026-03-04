# Migrations, CI, Formatting, Testing, and Admin UI — Guide

This repository includes migration scripts, CI workflows, formatting tooling, and basic admin UI plus audit logging. This document explains what was added, why, and how to run everything locally and in CI.

---

## What was added

1. Database migrations
   - `supabase/migrations/0001_init.sql` ... existing migrations
   - `supabase/migrations/0008_remove_visitor_insert_messages_policy.sql` — drops the RLS policy allowing anonymous visitor inserts into `messages`.
   - `supabase/migrations/0009_prevent_messages_on_closed_conversations.sql` — DB trigger to prevent inserting messages when conversation.status = 'closed'.
   - `supabase/migrations/0010_create_audit_log.sql` — creates `audit_logs` table for admin/audit events.
   - `supabase/rls.sql` — central RLS policies; updated to remove `Visitors can insert messages`.

2. CI & workflow
   - `.github/workflows/ci.yml` — runs on push/PR (main): installs deps, checks formatting, runs tests, and builds.
   - `.github/workflows/format-check.yml` — run Prettier check on PRs.
   - `.github/workflows/apply-migrations.yml` — a manual workflow to apply SQL migrations to a target Postgres DB using `SUPABASE_DB_URL` secret.

3. Formatting tooling
   - `prettier` configured via `.prettierrc` and `.prettierignore`.
   - `scripts/format-sql.js` using `sql-formatter` to format `.sql` files (supabase/ and migrations/).
   - `package.json` scripts:
     - `npm run format` — formats code & SQL
     - `npm run format:check` — checks formatting (CI)
     - `npm run format:sql` — SQL-only formatter

4. Tests
   - Unit tests added: `tests/cors.test.ts` (CORS helpers)
   - Integration tests added (skip unless SUPABASE\_\* env vars set):
     - `tests/messages_rls.test.ts` — ensures anonymous insert into messages is rejected.
     - `tests/messages_closed_conversation.test.ts` — ensures DB trigger prevents inserts into closed conversations.

5. Logging & audit
   - `src/lib/logger.ts` — simple `info`, `error`, and `auditLog` (writes to `audit_logs`).
   - `supabase/migrations/0010_create_audit_log.sql` — migration for audit log table.
   - `src/app/api/agents/invite/route.ts` — emits an audit log and info log when creating invites.

6. Admin UI
   - `src/app/dashboard/settings/page.tsx` — simple settings page to view/add/remove allowed domains for a tenant.

7. CORS hardening
   - `src/lib/cors.ts` and updated `src/app/api/tenant/authorize/route.ts` to only set `Access-Control-Allow-Origin` when the origin is validated against the tenant allowlist.

---

## Running migrations

### Locally

1. Ensure you have a Postgres connection string for your Supabase Postgres (service role DB connection). Example format:

```
postgresql://<user>:<password>@<host>:5432/<dbname>
```

2. Export it to `SUPABASE_DB_URL` and run the PowerShell helper (Windows PowerShell):

```powershell
$env:SUPABASE_DB_URL = "postgresql://user:pass@host:5432/db"
.\scripts\apply_supabase_migrations.ps1
```

The script will apply SQL files under `supabase/migrations` in lexicographic order and then apply `supabase/rls.sql`.

> Note: Be careful running migrations against production DBs. Always test in staging first.

### In GitHub Actions (manual)

1. In your repository settings, add a secret named `SUPABASE_DB_URL` with your Postgres connection string.
2. Open the repository's Actions tab, choose the `Apply Supabase Migrations` workflow, and run it (workflow_dispatch).

This workflow will run `psql` to apply files in `supabase/migrations/*.sql` and `supabase/rls.sql`.

---

## Formatting & Code style

- Prettier configured in `.prettierrc`.
- `.prettierignore` contains files to skip (e.g., `public/widget.js` to keep it compact).
- Format everything locally:

```powershell
npm install
npm run format
```

- Check formatting (CI)

```powershell
npm run format:check
```

CI will run `npm run format:check` on PRs and fail if formatting is not correct.

---

## Tests

- Run all tests (unit + integration). Integration tests will skip automatically unless the following env vars are set:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

```
npm test
```

- To run a single test file with Node's test runner:

```
node --test --import tsx tests/cors.test.ts
```

---

## CI (GitHub Actions)

Workflows added:

- `ci.yml` — runs on push/PR to `main`. Steps:
  - npm ci
  - npm run format:check
  - npm test
  - npm run build

- `format-check.yml` — runs Prettier check on PRs (optional/redundant with `ci.yml`).

- `apply-migrations.yml` — manual workflow to apply SQL migrations (requires `SUPABASE_DB_URL` secret).

Add repository secrets for integration tests/production use:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL` (for migrations workflow)

---

## Notes & best practices

- The removed visitor insert policy prevents anonymous clients from inserting messages directly. Visitor writes must now flow through the server route `/api/messages/send` that enforces `verifyWidgetToken()` and server-side rate limiting.

- The DB trigger enforces "closed means closed" for all inserts (agents, service role, etc.). If you need to allow certain internal maintenance scripts to bypass this, add an explicit bypass field or a specialized admin-only endpoint.

- Audit logs are written to `audit_logs`. This is simple, robust, and searchable in Supabase. Consider adding retention policies or exporting to an external log storage for long-term retention.

- The admin UI is intentionally minimal — it's a starting point. Consider adding:
  - Tenant selector UI
  - Role-based access controls in the UI
  - Invite history and audit log viewer
  - Pagination, validation, and UI polish

---

## Troubleshooting

- `psql` not found:
  - On macOS: `brew install postgresql`
  - On Ubuntu (CI): `sudo apt-get install -y postgresql-client`
  - On Windows: install PostgreSQL client or use WSL

- Formatting errors in CI:
  - Run `npm run format` locally and commit the changes, or set up a pre-commit hook (Husky + lint-staged).

- Integration tests fail:
  - Ensure the Supabase project used for tests has the schema/migrations applied and the test keys are correct. Use a staging project.

---

If you'd like, I can:

- Push these changes to a branch and open a PR with the explanation and CI checks enabled.
- Add Husky + lint-staged pre-commit hooks so developers don't open PRs with unformatted code.
- Wire Sentry or another error monitoring provider so server errors get reported automatically.
- Expand the admin UI with tenant search, audit log viewer, and invite flow pages.

Tell me which of these you'd like me to implement next and I will proceed.
