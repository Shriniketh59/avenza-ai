# Deploying AVENZA AI

- **Frontend** (Next.js): Cloudflare Workers, through the OpenNext adapter (`wrangler.jsonc`, `open-next.config.ts`).
- **Backend** (Flask, local speech and OCR models, SQLite, ChromaDB): an Oracle Cloud *Always Free* Ampere server
  (4 CPU, 24 GB RAM, 200 GB disk), reached through a Cloudflare Tunnel. It needs a persistent disk and ~5 GB of
  models, which Cloudflare Workers and Containers cannot provide.

```
browser ──https──> avenza.<domain>  (Cloudflare Worker: pages + /api route handlers)
                        │  server-side fetch, FLASK_API_URL
                        └──https──> api.<domain>  (Cloudflare Tunnel) ──> Oracle server :5000 (gunicorn)
```

## 1. Backend on Oracle Cloud

1. Oracle Cloud console → Compute → Create instance: **Ubuntu 24.04**, shape **VM.Standard.A1.Flex** (4 OCPU, 24 GB),
   boot volume 100 GB or more. Download the SSH key.
2. Cloudflare dashboard → Zero Trust → Networks → Tunnels → *Create a tunnel* (cloudflared). Copy its **token**.
   Add a public hostname: `api.<domain>` → `http://localhost:5000`.
3. On the server: `nano ~/avenza.env` (paste `.env.render`), then
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/Shriniketh59/avenza-ai/avenza-models-plugins/deploy/oracle/setup.sh
   CF_TUNNEL_TOKEN=<token> bash setup.sh
   ```
4. From this computer: `deploy/oracle/sync-voices.sh ubuntu@<server-ip> <ssh-key>` (copies the voices, ~2.4 GB).
5. Check `https://api.<domain>/health`.

Updates later: `bash /opt/avenza/deploy/oracle/update.sh` on the server.

## 2. Frontend on Cloudflare Workers

Needs Node.js 22+ for `wrangler`, and a Cloudflare API token with *Workers Scripts: Edit*
(and *Zone: Workers Routes: Edit* for a custom domain) in `CLOUDFLARE_API_TOKEN`.

1. In `wrangler.jsonc` set `APP_URL` (`https://avenza.<domain>`) and `FLASK_API_URL` (`https://api.<domain>`), and add
   `"routes": [{ "pattern": "avenza.<domain>", "custom_domain": true }]`.
2. Secrets (same values as the backend's):
   ```bash
   npx wrangler secret put AUTH_SECRET          # 32+ characters
   npx wrangler secret put GOOGLE_CLIENT_SECRET # only for Google sign-in
   ```
3. Deploy: `npm run cf:deploy`. Test the Cloudflare build locally first with `npm run cf:preview`.

## 3. Google sign-in

In Google Cloud console → APIs & Services → Credentials → your OAuth client:
- **Authorised redirect URIs**: add `https://avenza.<domain>/api/auth/google/callback` (keep the localhost one for development).
- **Authorised JavaScript origins**: add `https://avenza.<domain>`.

OAuth consent screen (Google Auth Platform → Audience): **Publish app** ("In production"). In *Testing* only listed
test users can sign in, and their sign-in expires after 7 days. The app asks only for name, email and photo, so
publishing needs no Google review.

The frontend needs `GOOGLE_CLIENT_ID` (var) and `GOOGLE_CLIENT_SECRET` (secret); the backend needs the same
`GOOGLE_CLIENT_ID` in `~/avenza.env` (it checks that each Google sign-in was issued for this client).

## 4. Keeping the Gemini API working

- **Backup keys**: put one or more keys from *other* Google Cloud projects in `GEMINI_BACKUP_API_KEYS`
  (comma-separated) in `~/avenza.env`. If the main key is rejected, revoked or out of quota, the backend switches to
  the next one by itself. `https://api.<domain>/health` shows `keys` and `keys_failing` (by number, never the key).
- **Billing**: the free tier has small daily limits per model, and images need billing. For a live site, turn on
  billing for the main key's project (Google AI Studio → Billing) and set a budget alert in Google Cloud.
- **Never commit a key**: Google disables keys it finds in public repositories (this repo is public). Keys live
  only in `~/avenza.env` on the server; `.env*` files are git-ignored.
- **Restrict the key**: Google Cloud → Credentials → the key → *API restrictions*: Generative Language API only.
- **Monitor**: point a free uptime monitor (e.g. UptimeRobot) at `https://api.<domain>/health`.

Notes:
- The Worker is ~3.0 MB compressed: just inside the free plan's 3 MB limit. The free plan also allows only
  10 ms of CPU per request; if pages fail with error 1102, switch to Workers Paid ($5/month: 10 MB, 30 s CPU).
- Google sign-in: add `https://avenza.<domain>/api/auth/google/callback` to the OAuth client's redirect URIs.
- The camera and microphone work, since the site is served over https.
