# CamMonSys

CamMonSys is a role-based camera monitoring system built for a take-home technical assessment. It supports live camera publishing and viewing, device status monitoring, real-time event updates, event response workflows, device groups, audit history, and administrative controls.

## Features

- Cookie-based authentication backed by revocable server-side sessions.
- Admin, Monitor, and Responder roles with backend-enforced authorization.
- Device registration, grouping, search, filtering, status tracking, and soft deletion.
- Browser camera publishing with heartbeats and online/offline detection.
- LiveKit-based remote camera viewing with short-lived, room-scoped tokens.
- Authenticated server-sent events (SSE) for live dashboard updates.
- Monitoring events with `OPEN`, `ACKNOWLEDGED`, and `RESOLVED` states.
- Responder assignment, instructions, optional completion notes, and assignment-scoped camera access.
- Camera-access revocation after reassignment, unassignment, or resolution.
- Searchable, filterable, and sortable Admin audit history.
- Password-protected Admin control lock.
- PostgreSQL integration tests covering authentication, authorization, devices, events, groups, Responders, audit logs, and publishing sessions.

## Technology

- React, React Router, Vite, and TypeScript
- Express 5 and TypeScript
- PostgreSQL 17 with `pg`
- LiveKit Cloud for video delivery
- Vitest and Supertest for API and integration tests
- Docker and Docker Compose for local infrastructure and production builds

## Prerequisites

- WSL Ubuntu on Windows
- Node.js 22 via `nvm`
- npm
- Docker Engine with Docker Compose v2
- A LiveKit Cloud project

Run all commands from the repository root inside WSL.

## Initial setup

Install dependencies and create the local environment file:

```bash
source ~/.nvm/nvm.sh
nvm install
nvm use
npm ci
cp .env.example .env
```

Skip the copy if `.env` already contains local configuration. Replace every placeholder in `.env`.

Start PostgreSQL:

```bash
npm run db:up
```

The default Compose configuration exposes PostgreSQL on `127.0.0.1:5433`. If you change the database username, database name, or password, update the connection URLs in `.env` as well.

### Initialize the databases

Compose creates the development database but does not automatically run the application SQL files. Apply them in numeric order:

```bash
docker compose exec -T db psql -U cammon -d cammon < apps/api/sql/001_init.sql
docker compose exec -T db psql -U cammon -d cammon < apps/api/sql/002_auth_sessions.sql
docker compose exec -T db psql -U cammon -d cammon < apps/api/sql/003_publishing_lease.sql
docker compose exec -T db psql -U cammon -d cammon < apps/api/sql/004_camera_room_cleanup.sql
docker compose exec -T db psql -U cammon -d cammon -v ON_ERROR_STOP=1 < apps/api/sql/005_publication_readiness.sql
docker compose exec -T db psql -U cammon -d cammon -v ON_ERROR_STOP=1 < apps/api/sql/006_responder_revocation.sql
```

Create and initialize the isolated test database:

```bash
docker compose exec db createdb -U cammon cammon_test
docker compose exec -T db psql -U cammon -d cammon_test < apps/api/sql/001_init.sql
docker compose exec -T db psql -U cammon -d cammon_test < apps/api/sql/002_auth_sessions.sql
docker compose exec -T db psql -U cammon -d cammon_test < apps/api/sql/003_publishing_lease.sql
docker compose exec -T db psql -U cammon -d cammon_test < apps/api/sql/004_camera_room_cleanup.sql
docker compose exec -T db psql -U cammon -d cammon_test -v ON_ERROR_STOP=1 < apps/api/sql/005_publication_readiness.sql
docker compose exec -T db psql -U cammon -d cammon_test -v ON_ERROR_STOP=1 < apps/api/sql/006_responder_revocation.sql
```

`createdb` reports an error if `cammon_test` already exists; in that case, continue with the SQL commands. Replace `cammon` in these commands if `.env` uses different database names or credentials.

Seed the configured Admin, Monitor, and Responder accounts:

```bash
npm run seed -w @cammon/api
```

Seed passwords must be at least 12 characters. Seeding is idempotent by email and does not overwrite existing accounts.

## Development

Start the API and Vite development server:

```bash
npm run dev
```

- Web application: `http://localhost:5173`
- API: `http://localhost:3000`
- Health check: `http://localhost:3000/api/health`

Vite proxies `/api` requests to Express. Camera capture requires a secure browser context; localhost is accepted during development, while non-local deployments must use HTTPS.

Useful database commands:

```bash
npm run db:logs
npm run db:down
```

`db:down` stops PostgreSQL without deleting its persistent volume.

## Role workflows

### Admin

- Register and manage devices and device groups.
- Publish a registered device's browser camera.
- View every active device and monitoring event.
- Assign, reassign, or unassign Responders.
- Acknowledge and resolve events.
- Soft-delete devices that have no unresolved events.
- Search and filter the audit log.
- Lock administrative controls and reauthenticate to unlock them.

### Monitor

- View all active devices and camera feeds.
- Search and filter devices and groups.
- View monitoring events.
- Assign, reassign, or unassign Responders.
- Acknowledge and resolve events.

### Responder

- View only unresolved events assigned to their account.
- Read the assigned location and response instructions.
- Acknowledge an open assignment.
- View only cameras associated with active assignments.
- Resolve an acknowledged assignment with an optional completion note.
- Lose camera access when the last applicable assignment is reassigned, unassigned, or resolved.

## Monitoring flow

1. An Admin registers a device and starts its camera page.
2. The browser requests camera permission and publishes video to a LiveKit room scoped to the current publishing session.
3. Heartbeats renew the publishing lease and update Last Seen.
4. The camera page creates Test Alerts; the API also accepts simulated motion and bed-exit types.
5. PostgreSQL saves the event before the API emits an SSE invalidation signal.
6. Admin and Monitor dashboards refetch authorized state without a full page reload.
7. An Admin or Monitor may assign a Responder with instructions.
8. The Responder acknowledges the event, performs the response, and resolves it.

SSE messages contain no device or event records; they only notify clients to refetch. REST endpoints enforce role and assignment authorization.

## Event lifecycle

Valid event transitions are:

```text
OPEN -> ACKNOWLEDGED -> RESOLVED
```

Transitions are atomic and reject stale or conflicting updates. Status changes and their audit entries are written together. Resolved events cannot be reassigned.

## Camera authorization

The API checks device access before issuing a short-lived LiveKit viewer token. Admin and Monitor users may view active devices. A Responder must have at least one unresolved assignment for the requested device.

Responder viewer identities are deterministic, allowing the backend to disconnect an existing LiveKit participant after access ends. A Responder remains authorized if another active assignment still applies to the same device.

Revocations are queued transactionally by a PostgreSQL trigger and retried by the cleanup worker after service failures. Immediate removal is attempted first. This depends on LiveKit Cloud token revocation; real Cloud failure/reconnect behavior still needs a live demo check.

Camera capture starts on page entry. Locking controls keeps the mounted publication running; a reload while locked waits for password unlock before mounting the camera again. Stop remains stopped until explicitly started again.

Publication readiness uses publishing_started_at so a new reservation cannot reuse historical Last Seen to claim Online. Logout clears owned publications and queues remote room cleanup.

## API overview

- `/api/auth`: login, current user, logout, and Admin reauthentication
- `/api/devices`: registration, listing, detail, grouping, deletion, publishing, heartbeat, stop, events, and view tokens
- `/api/device-groups`: group creation, listing, and deletion
- `/api/events`: event listing, assignment, and status transitions
- `/api/responders`: Admin/Monitor Responder directory
- `/api/audit-logs`: Admin audit listing and filter options
- `/api/stream`: authenticated SSE invalidation stream
- `/api/health`: application and database health

The complete machine-readable contract, including authentication, role constraints, request schemas, response schemas, and error cases, is in [docs/openapi.yaml](docs/openapi.yaml).

## Validation and verification

Run the complete verification sequence:

```bash
npm run typecheck
npm test
npm run build
```

The web workspace currently uses TypeScript validation and production builds; automated tests are in the API workspace. Integration tests require `TEST_DATABASE_URL` to point to a database different from `DATABASE_URL` and refuse to run against any database not named `cammon_test`.

## Production build

After building, Express serves the React application, including frontend routes:

```bash
npm run build
npm start
```

Open `http://localhost:3000`. Stop the development processes first so the API port is available.

## Container build

Build the production image:

```bash
docker build -t cammon:local .
```

The container expects runtime configuration through environment variables and must be able to reach PostgreSQL and LiveKit. A container's `localhost` refers to that container, not the host database.

The repository provides a production application image but does not provision GKE, Cloud SQL, HTTPS ingress, or secret management. A GCP deployment should supply those separately and run the SQL migrations before starting application traffic.

## Project structure

- `apps/web`: React application, role pages, camera publisher/viewer, and API clients
- `apps/api`: Express API, authorization, domain services, workers, and tests
- `apps/api/sql`: ordered PostgreSQL schema files
- `docs/plan.md`: architecture and implementation decisions
- `compose.yaml`: local PostgreSQL with persistent storage
- `Dockerfile`: multi-stage production application image

## Environment variables

See `.env.example` for the complete list.

- `DATABASE_URL`: development/production PostgreSQL connection
- `TEST_DATABASE_URL`: isolated integration-test database
- `JWT_SECRET`: authentication signing secret of at least 32 characters
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: video service credentials
- `AUTH_SESSION_DURATION_SECONDS`: login-session lifetime
- `CAMERA_HEARTBEAT_INTERVAL_SECONDS`: publisher heartbeat frequency
- `CAMERA_PUBLISHING_LEASE_SECONDS`: time before a silent publisher is considered inactive
- `CAMERA_CLEANUP_INTERVAL_SECONDS`: stale LiveKit room cleanup interval
- `SSE_KEEPALIVE_INTERVAL_SECONDS`: SSE session-validation and keepalive interval
- `APP_ORIGIN`: exact public HTTPS origin for mutation-origin validation behind a proxy
- `DEMO_*`: demo account names, emails, and passwords used by the seed command

The publishing lease must be at least three times the heartbeat interval.


## Assessment status

The functional assessment requirements are implemented: role-based authentication and refresh persistence, device registration, automatic camera-page startup, Online/Offline and Last Seen tracking, live device/event refreshes, persisted simulated alerts, camera detail viewing, and the OPEN → ACKNOWLEDGED → RESOLVED workflow. Bonus work includes the Responder role, LiveKit video, groups/search/filtering, audit history, and API tests.

Responsive visual acceptance against the supplied Figma design and public deployment are the remaining submission phases. See [docs/plan.md](docs/plan.md) for the requirement-by-requirement audit and acceptance checklist.

## Current deployment status

No public deployment or public demo accounts are included. Run the system locally or provide the documented runtime infrastructure and secrets for deployment.

## Local verification limits

The SSE emitter and authentication attempt limiter are per-process; use one API instance until shared messaging/rate limiting is configured. Login and reauthentication are limited to 60 requests per IP per 15 minutes.

An optional browser smoke script, scripts/camera-smoke.cjs, exercises automatic camera entry, lock/unlock, Stop, and camera layout widths of 375/768/1440 pixels. It requires Playwright and Chrome (or Playwright Chromium), a Vite server on port 5174, and mocks API/LiveKit traffic. Set PLAYWRIGHT_MODULE, CHROME_PATH and SMOKE_URL if needed. This does not verify real LiveKit transport or every screen's visual layout.
