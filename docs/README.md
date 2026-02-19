# Video Transcriber Documentation

This folder contains complete documentation for the current codebase.

## Documentation Map

- `docs/ARCHITECTURE.md` - System design, runtime components, and data flows.
- `docs/API.md` - Full HTTP API reference.
- `docs/CONFIGURATION.md` - Environment variables and runtime knobs.
- `docs/DEPLOYMENT.md` - Local and Railway deployment instructions.
- `docs/BACKEND.md` - Backend module and job lifecycle guide.
- `docs/FRONTEND.md` - Frontend structure, state, and user flows.
- `docs/CODEBASE_REFERENCE.md` - File-by-file reference for every tracked source file.

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env template:
   ```bash
   cp .env.example .env
   ```
3. Set required keys in `.env`:
   - `ASSEMBLYAI_API_KEY`
   - `ANTHROPIC_API_KEY`
4. Run server:
   ```bash
   npm start
   ```
5. Open app at `http://localhost:3000`.

## Scope

This documentation covers all tracked project files returned by `git ls-files`, including backend, frontend, infrastructure files, and vendored browser FFmpeg assets.
