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

Notes:
- The Worker is ~3.0 MB compressed: just inside the free plan's 3 MB limit. The free plan also allows only
  10 ms of CPU per request; if pages fail with error 1102, switch to Workers Paid ($5/month: 10 MB, 30 s CPU).
- Google sign-in: add `https://avenza.<domain>/api/auth/google/callback` to the OAuth client's redirect URIs.
- The camera and microphone work, since the site is served over https.
