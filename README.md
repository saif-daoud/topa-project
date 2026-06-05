# TOPA Expert Refinement

This app lets one therapy expert refine the TOPA Late Fusion ontology from a GitHub Pages frontend while changes are stored in Cloudflare D1 through a Worker.

## Frontend

- Local URL: `http://127.0.0.1:5173/topa-project/`
- GitHub Pages base path: `/topa-project/`
- Local API fallback: `http://127.0.0.1:8789/api`
- Production API env var: `VITE_API_BASE`

## Worker

- Folder: `worker`
- Worker name: `topa-ontology-review-worker`
- Local dev port: `8789`
- D1 database name: `topa_ontology_review_db`
- Production Worker: `https://topa-ontology-review-worker.saif-sedaoud.workers.dev`
- Production D1 ID: `d779c033-24f4-4a7a-bd7e-b426e32d8879`

## Production Deployment

Three different secrets/identifiers are involved:

- `TOKEN_SECRET`: a long random HMAC secret used by the running Worker to sign therapist sessions. Store it as a Cloudflare Worker secret, not in D1 or Git.
- `CLOUDFLARE_API_TOKEN`: lets the GitHub Action apply D1 migrations and deploy the Worker. Store it as a GitHub Actions repository secret.
- `CLOUDFLARE_ACCOUNT_ID`: identifies the Cloudflare account. Store it as a GitHub Actions repository secret.

The therapist access code is separate. Migration `0004_seed_review_access_code.sql` stores the SHA-256 hash for the reusable access code `review` in D1.

The production D1 database, migrations, Worker, `TOKEN_SECRET`, and `review` access code are already configured. The remaining GitHub setup is adding the two Actions repository secrets below.

### 1. Create And Configure Cloudflare D1

For a fresh Cloudflare recreation, authenticate Wrangler and create the production database:

```bash
npx wrangler login
npx wrangler d1 create topa_ontology_review_db --config worker/wrangler.toml
```

Copy the returned database ID into `worker/wrangler.toml`.

```toml
database_id = "<NEW_D1_DATABASE_ID>"
```

Generate a long random `TOKEN_SECRET`, then store it directly in Cloudflare:

```bash
openssl rand -hex 32
npx wrangler secret put TOKEN_SECRET --config worker/wrangler.toml
```

Apply migrations and deploy the Worker once:

```bash
npm --prefix worker install
npm run worker:migrate:remote
npm run worker:deploy
```

The production Worker URL used by the GitHub Pages build is:

```text
https://topa-ontology-review-worker.saif-sedaoud.workers.dev/api
```

### 2. Configure GitHub

In the `saif-daoud/topa-project` repository:

1. Open **Settings > Secrets and variables > Actions**.
2. Add `CLOUDFLARE_API_TOKEN` with Worker Scripts edit and D1 edit permissions.
3. Add `CLOUDFLARE_ACCOUNT_ID`.
4. Open **Settings > Pages** and select **GitHub Actions** as the source.
5. Push the repository to `main`, or run the **Deploy to GitHub Pages** workflow manually.

The workflow applies D1 migrations, deploys the Worker, builds the frontend, and publishes:

```text
https://saif-daoud.github.io/topa-project/
```

For local development:

```bash
npm run dev:worker
npm run dev
```

The local Worker script uses a development-only token secret. Never reuse it in production.

```bash
npx wrangler secret put TOKEN_SECRET --config worker/wrangler.toml
```

## Stored Review Data

The Worker stores:

- `review_changes`: every add/edit/remove/restore/revoke with old/new JSON values and paths.
- `review_feedback`: component-level therapist comments.
- `review_snapshots`: latest editable ontology state for resume/export.
- `participants` and `access_codes`: reviewer access and identity.

The frontend also keeps browser-local autosave data and highlights changes in real time:

- Green: added content.
- Blue: edited content.
- Red: deleted content or removed-field tombstones.
- Dimmed log entries: changes that have been revoked.

Revoked changes expose **Remove history**, which permanently deletes both the original revoked entry and its paired revoke entry from D1.

## Access Codes

Insert SHA-256 hashes into `access_codes`. Because the therapist only enters an access code, use `uses_remaining = NULL` if you want the same code to work again after clearing browser storage.

The production migration already inserts the reusable code `review`.

Example PowerShell hash helper:

```powershell
$code = "your-review-code"
$bytes = [Text.Encoding]::UTF8.GetBytes($code)
$hash = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
($hash | ForEach-Object { $_.ToString("x2") }) -join ""
```

Then insert that hash into D1.
