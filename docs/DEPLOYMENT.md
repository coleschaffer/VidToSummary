# Deployment

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env template and fill variables:
   ```bash
   cp .env.example .env
   ```
3. Ensure local tooling exists if you will use YouTube/Meta download paths:
   - `ffmpeg`
   - `yt-dlp`
4. Start app:
   ```bash
   npm start
   ```

## Docker

The provided `Dockerfile`:

- Uses `node:20-slim`.
- Installs `ffmpeg`, Python, pip, yt-dlp, and Deno.
- Installs production npm dependencies.
- Creates `uploads/` and `temp/`.
- Runs `node server.js` on port 3000.

Build and run example:

```bash
docker build -t video-transcriber .
docker run --env-file .env -p 3000:3000 video-transcriber
```

## Railway

`railway.toml` includes deploy-level settings:

- healthcheck path `/`
- healthcheck timeout `300`
- restart policy `ON_FAILURE` with max retries `3`

Typical Railway flow:

1. `railway login`
2. `railway init`
3. Set required variables in Railway dashboard/CLI.
4. `railway up`

## Required Production Secrets

At minimum set:

- `ASSEMBLYAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `SUPADATA_API_KEY` (if YouTube transcript endpoint used)
- `DECODO_PROXY_USER` and `DECODO_PROXY_PASS` (if download endpoints used)
- `ADMIN_PASSWORD` (must not use default)

## Operational Notes

- App still runs if `DATABASE_URL` is missing, but admin history persistence is limited.
- Temp artifacts are created in `uploads/` and `temp/`; cleanup is handled by intervals, but disk monitoring is still recommended.
- Large uploads/long downloads are expected and server timeouts are set accordingly.
