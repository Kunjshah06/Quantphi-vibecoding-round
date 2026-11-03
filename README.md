# Devfolio

A GitHub developer portfolio dashboard with live profile and repository analytics, a contribution calendar, language breakdown, job-stack matching, and portfolio Q&A.

## Run locally

1. Install frontend packages with `npm install`.
2. Install backend packages with `python -m pip install -r backend/requirements.txt`.
3. Optionally copy `backend/.env.example` to `backend/.env` and set `GITHUB_TOKEN` to raise GitHub API limits and unlock contribution history. `OPENAI_API_KEY` enables LLM-powered portfolio answers; without it, the assistant uses a deterministic portfolio-aware fallback.
4. Start the API: `python -m uvicorn backend.main:app --reload --port 8000`.
5. In another terminal, start the UI: `npm run dev`.

The UI is served at `http://localhost:5173`; Vite proxies `/api` requests to FastAPI on port 8000. Profile and repository data are cached in SQLite for 15 minutes by default (`CACHE_TTL_MINUTES` can change this). Contributions are not fabricated: they remain unavailable until a GitHub token is configured.