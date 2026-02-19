# Codebase File Reference

This file documents every tracked file in the repository (`git ls-files`).

## Root Files

- `.env.example`
  - Example environment variable template.

- `.gitignore`
  - Ignores local/private artifacts such as `.env`, `node_modules`, `uploads`, and macOS metadata.

- `Dockerfile`
  - Production container build; installs ffmpeg/yt-dlp runtime dependencies and starts `server.js`.

- `package.json`
  - Project metadata, scripts (`start`, `dev`), and runtime dependencies.

- `package-lock.json`
  - NPM lockfile for deterministic dependency resolution.

- `railway.toml`
  - Railway deployment policy configuration.

- `server.js`
  - Main Express server and API implementation.

- `db.js`
  - Optional PostgreSQL integration and persistence helpers.

## Library Modules

- `lib/queue.js`
  - Queue/rate-limit/session helpers and cleanup intervals.

## Frontend App

- `public/index.html`
  - Primary user interface markup.

- `public/script.js`
  - Full client behavior for upload, polling, summaries, downloads, clips, settings, and history.

- `public/styles.css`
  - Styling for the main app, sidebars, queues, results, prompts, and clip modal.

- `public/admin.html`
  - Admin dashboard markup, styling, and JS logic in one file.

## Vendored FFmpeg Browser Assets

- `public/ffmpeg/ffmpeg.min.js`
  - FFmpeg WASM wrapper runtime for browser usage.

- `public/ffmpeg/util.min.js`
  - Helper utilities used by browser FFmpeg runtime.

- `public/ffmpeg/ffmpeg-core.js`
  - Core JS loader for FFmpeg WASM.

- `public/ffmpeg/ffmpeg-core.wasm`
  - WebAssembly binary used for audio extraction and clip creation.

- `public/ffmpeg/814.ffmpeg.js`
  - Additional chunk/runtime artifact used by the local FFmpeg bundle.

## Documentation Files

- `docs/README.md`
  - Documentation index and quickstart.

- `docs/ARCHITECTURE.md`
  - System architecture and data flows.

- `docs/API.md`
  - HTTP endpoint reference.

- `docs/CONFIGURATION.md`
  - Environment and runtime configuration.

- `docs/DEPLOYMENT.md`
  - Deployment guide for local, Docker, and Railway.

- `docs/BACKEND.md`
  - Backend module details and job lifecycle documentation.

- `docs/FRONTEND.md`
  - Frontend structure and behavior documentation.

- `docs/CODEBASE_REFERENCE.md`
  - This file.
