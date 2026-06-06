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

## Production Deployment

Three different secrets/identifiers are involved:

- `TOKEN_SECRET`: a long random HMAC secret used by the running Worker to sign therapist sessions. Store it as a Cloudflare Worker secret, not in D1 or Git.
- `CLOUDFLARE_API_TOKEN`: lets the GitHub Action apply D1 migrations and deploy the Worker. Store it as a GitHub Actions repository secret.
- `CLOUDFLARE_ACCOUNT_ID`: identifies the Cloudflare account. Store it as a GitHub Actions repository secret or local environment variable, not in `wrangler.toml`.
- `CLOUDFLARE_D1_DATABASE_ID`: identifies the Cloudflare D1 database. Store it as a GitHub Actions repository secret or local environment variable, not in `wrangler.toml`.

The therapist access code is separate. Do not commit the plaintext code or its SHA-256 hash. Insert access-code hashes directly into D1 using a private local command or the Cloudflare dashboard.

### 1. Create And Configure Cloudflare D1

For a fresh Cloudflare recreation, authenticate Wrangler and create the production database:

```bash
npx wrangler login
npx wrangler d1 create topa_ontology_review_db --config worker/wrangler.toml
```

Store the returned database ID in `CLOUDFLARE_D1_DATABASE_ID`. For one-off local Wrangler commands, temporarily provide that value through your shell environment or a private local config.

```toml
database_id = "REPLACE_WITH_TOPA_ONTOLOGY_REVIEW_D1_DATABASE_ID"
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

### 2. Configure GitHub

In the `saif-daoud/topa-project` repository:

1. Open **Settings > Secrets and variables > Actions**.
2. Add `CLOUDFLARE_API_TOKEN` with Worker Scripts edit and D1 edit permissions.
3. Add `CLOUDFLARE_ACCOUNT_ID`.
4. Add `CLOUDFLARE_D1_DATABASE_ID`.
5. Open **Settings > Pages** and select **GitHub Actions** as the source.
6. Push the repository to `main`, or run the **Deploy to GitHub Pages** workflow manually.

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
echo TOKEN_SECRET=<LOCAL_RANDOM_SECRET> > worker/.dev.vars
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

Example PowerShell hash helper:

```powershell
$code = "your-review-code"
$bytes = [Text.Encoding]::UTF8.GetBytes($code)
$hash = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
($hash | ForEach-Object { $_.ToString("x2") }) -join ""
```

Then insert that hash into D1 with a private command or the Cloudflare dashboard. Do not commit the resulting hash.
