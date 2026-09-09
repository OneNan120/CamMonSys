# CamMonSys

Camera monitoring assessment. The current milestone sets up React/Vite, an Express API, and local PostgreSQL. Authentication, cameras, events, and group features are not implemented yet.

## Prerequisites

- WSL Ubuntu (on Windows), Node.js 22.23.2 via nvm, and npm.
- A running Docker engine with Docker Compose v2.
- LiveKit Cloud credentials will be needed for the camera milestone, not for this setup.

Run commands inside WSL from the repository root:

```bash
source ~/.nvm/nvm.sh
nvm install
nvm use
npm ci
cp .env.example .env
```

Skip the copy if a local `.env` already exists. Choose a local database password and use the same value in `POSTGRES_PASSWORD` and `DATABASE_URL` (URL-encode special characters in the URL). Keep credentials out of Git. Port 5433 is used locally to avoid the usual PostgreSQL port.

## Development

```bash
npm run db:up
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to Express on port 3000; the setup page checks database connectivity. The API health endpoint is http://localhost:3000/api/health. It returns 503 if the database is unavailable.

```bash
npm run typecheck
npm test
npm run build
npm start
```

After building, Express serves the React application at http://localhost:3000, including frontend routes. Stop the development server before starting the production build on the same port.

`npm run db:down` stops PostgreSQL without deleting data. `npm run db:logs` shows its logs. Do not remove the Compose volume unless you intend to erase local data.

## Structure

- `apps/web`: React, React Router, Vite, and CSS.
- `apps/api`: Express, configuration validation, PostgreSQL connectivity, and health tests.
- `docs/plan.md`: implementation decisions.
- `compose.yaml`: local PostgreSQL with a persistent volume.
- `Dockerfile`: production application image for later GKE deployment.

Database access currently uses `pg`; application schema and migrations belong to subsequent feature work. Tests check HTTP health behavior using a supplied database check; the running setup page verifies the real database.

## Container build

```bash
docker build -t cammon:local .
```

The image expects a reachable `DATABASE_URL` supplied at runtime. A container's localhost is not the host PostgreSQL address. For GKE, supply Cloud SQL connectivity and secrets through the deployment configuration; this setup does not provision cloud resources.

## Environment

See `.env.example`. Only `DATABASE_URL` is required by the API today; `PORT` defaults to 3000. LiveKit and JWT entries are placeholders for later milestones. Never place backend secrets in Vite-prefixed environment variables, which are exposed to browsers.

No public deployment or demo accounts exist yet.
