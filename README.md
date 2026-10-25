# Supabase Control Centre — Tester-2

This repository now contains a dashboard UI and a Supabase Edge Function that keeps the Supabase Management API token on the server. The dashboard does **not** ask for or store a service-role key in the browser.

## What is implemented

- Dark responsive dashboard with overview, project inventory, schema/table explorer, SQL terminal, auth status panel, and session activity log.
- Server-side project allowlist. Only project refs listed in `CONTROLLED_PROJECT_REFS` can be inspected or queried.
- Management API calls are made by the Edge Function using `SUPABASE_ACCESS_TOKEN`; that token is never returned to the browser.
- Edge Function validates the user's Supabase session and checks their email against `CONTROL_ADMIN_EMAILS`.
- SQL console supports one statement at a time, has a 20,000-character limit, blocks selected high-risk server/role operations, and requires explicit confirmation for write/schema-changing statements.
- Table inventory and column metadata are fetched with read-only SQL queries. The UI escapes data before rendering it.
- No fake CPU/RAM values are presented as real server metrics.

## Important boundaries

This is a management control plane, not a magic browser-only Supabase account administrator. Supabase Management API capabilities depend on your account token and plan. Project metrics, database size, logs, encryption controls, backups, billing, and project creation/deletion are not fabricated or exposed unless a supported API is integrated. The current dashboard does not create/delete Supabase projects, change billing/security settings, or invite/delete Auth users. The Auth panel explains that limitation instead of pretending those actions succeeded.

Treat SQL write access as production-grade privileged access. Use a dedicated Supabase account, protect its login with MFA, keep the access token narrowly scoped if supported, and add a second approval gate before exposing this dashboard to anyone else.

## Deployment

### 1. Create a dedicated control project

Create a separate Supabase project for this control plane. Do not use your QR ordering or Dairy Management production project as the control plane. In its Authentication settings, enable email/password or your chosen sign-in method and create your own admin user.

### 2. Configure Edge Function secrets

In the control project's dashboard, open **Edge Functions → Secrets** and add:

- `SUPABASE_ACCESS_TOKEN`: a Supabase Personal Access Token that can access the projects you intend to administer. Never put it in GitHub or HTML.
- `CONTROL_ADMIN_EMAILS`: comma-separated exact email addresses allowed to use this control plane.
- `CONTROLLED_PROJECT_REFS`: No project-ref list is required. The dashboard discovers all projects visible to this token. For least privilege, use a dedicated Supabase account/token that can access only the projects you intend to manage; test with a disposable project first.
- `DASHBOARD_ORIGIN`: exact deployed dashboard origin, e.g. `https://mayuu-p.github.io` (or the exact project Pages URL if using a project-specific origin).

The platform provides `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the Edge Function. Do not create browser-accessible secrets.

### 3. Deploy the Edge Function

Install the Supabase CLI, log in, link the dedicated control project, then run from this repository:

```sh
supabase login
supabase link --project-ref YOUR_CONTROL_PROJECT_REF
supabase functions deploy control-centre
```

The `supabase/config.toml` file enables JWT verification for the function. Configure the secrets before testing it.

### 4. Configure the static dashboard

Open **Settings** in the dashboard and enter the control project's URL and its **publishable/anon key**. These values are intended for a browser client; they are not the Management API token. The dashboard signs you in through Supabase Auth, then calls the Edge Function using the user's access token.

### 5. Enable GitHub Pages

In GitHub, open **Settings → Pages**, choose the `main` branch and `/(root)`, and save. The site is served at:

`https://mayuu-p.github.io/Tester-2/`

### 6. Verify safely

1. Use a Management API token/account limited to a disposable/test project first, if possible.
2. Sign in using an email listed in `CONTROL_ADMIN_EMAILS`.
3. Refresh projects and inspect the schema.
4. Run `SELECT current_database(), current_user;` first.
5. Test writes only in the disposable project.
6. Check function logs and browser console for errors before allowing production refs.

## SQL examples

Read-only inventory query:

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;
```

Column metadata:

```sql
SELECT table_schema, table_name, ordinal_position, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name, ordinal_position;
```

## Security notes

- Never paste `service_role`, `sb_secret_*`, or a Supabase Personal Access Token into the dashboard, GitHub, browser local storage, or screenshots.
- Do not expose this public GitHub Pages app as the only security boundary. The Edge Function performs authorization, but you should also restrict dashboard access and review auth policies.
- SQL can permanently alter or destroy data. A confirmation dialog is not a backup. Use backups, test environments, and change review.
- Keep the allowed project list short and review it regularly.
