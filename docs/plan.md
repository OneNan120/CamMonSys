# Implementation Plan

This reflects the implementation plan and design decisions made during development. The final implementation may differ slightly from the original plan.

## Objective

- Different user roles

- Camera access

- Device status

- Monitoring events

- Web-based monitoring dashboard

## Tech Stack

- Frontend: React, TypeScript, HTML, CSS

- Backend: Express, TypeScript

- Database: PostgreSQL

- Camera delivery: LiveKit Cloud

- Deployment: Docker image, Render

- Authentication: Argon2 password hashes; JWT in an HttpOnly, SameSite=Lax cookie (Secure in production), backed by revocable PostgreSQL auth_sessions. No refresh-token endpoint; expired sessions require sign-in.

- Updates: REST reads/mutations plus authenticated SSE invalidations; LiveKit carries video.

## API Documentation

| Method | Route | Description |

|--------|-------|-------------|

| POST | /api/auth/reauthenticate | Verify an Admin password to unlock client-side controls |

| POST | /api/auth/login | Sign in using one flow for all roles |

| POST | /api/auth/logout | Sign out and invalidate the login session |

| POST | /api/device-groups | Admin creates a device group |

| GET | /api/device-groups | Admin/Monitor lists all groups for filtering; Responders cannot use this endpoint |

| POST | /api/devices | Admin creates a device |

| PATCH | /api/devices/:deviceId/group | Admin assigns an existing groupId or sets it to null to remove grouping |

| POST | /api/devices/:deviceId/events | Create a test event |

| GET | /api/auth/me | Retrieve the authenticated user |

| GET | /api/devices | Retrieve permitted devices and status |

| GET | /api/devices/:deviceId | Retrieve a device |

| GET | /api/events | List recent events for Admin/Monitor; optional deviceId query filters device history |

| GET | /api/events?assignedTo=me | Retrieve the authenticated Responder's assigned events |

| PATCH | /api/events/:eventId/status | Update an event's status |

| PATCH | /api/events/:eventId/assignment | Admin/Monitor assigns or reassigns an event to a Responder |

| POST | /api/devices/:deviceId/heartbeat | Record a report from the active camera |

| POST | /api/devices/:deviceId/start | Admin reserves a publishing session and receives a room-scoped publishing token |

| POST | /api/devices/:deviceId/view-token | Issue a subscription-only token after role/assignment checks |

| GET | /api/responders | Admin/Monitor lists Responders for assignment |

| GET | /api/audit-logs | Admin queries audit history with search, filters and sorting |

| GET | /api/audit-logs/filter-options | Admin retrieves audit filter choices |

| GET | /api/stream | Authenticated SSE invalidations for all three roles; records are fetched through authorized REST APIs |

| GET | /api/health | Application and database health |

| POST | /api/devices/:deviceId/stop | End the active camera publication |

| DELETE | /api/devices/:deviceId | Admin soft-deletes a device only when no unresolved events exist; preserve events and audit history |

| DELETE | /api/device-groups/:groupId | Admin deletes a group; retain its devices and set their groupId to null |

The complete machine-readable OpenAPI 3.1 contract is in `docs/openapi.yaml`.

## Database Schema

1. DeviceGroup (optional bonus)

    - id

    - name

2. User:

    - id

    - name

    - email: unique login identifier

    - passwordHash

    - role: ADMIN | MONITOR | RESPONDER

3. Device

    - id

    - name

    - location

    - createdById -> User.id

    - groupId: nullable -> DeviceGroup.id; optional field, with ON DELETE SET NULL

    - status: ONLINE | OFFLINE, derived from active publication and lastSeenAt

    - lastSeenAt

    - publishingSessionId: identifies the current publisher and rejects stale heartbeat/stop requests

    - publishingOwnerSessionId -> AuthSession.id: login session that owns publication

    - publishingLeaseExpiresAt: server-side publication lease

    - publishingStartedAt: identifies whether Last Seen belongs to the current publication

    - deletedAt: nullable soft-deletion timestamp

    - stream_version: API alias for publishingSessionId; not a separate database column

    - auditLogs: relationship to AuditLog records

4. Event:

    - id

    - deviceId -> Device.id

    - type

    - createdAt

    - status: OPEN | ACKNOWLEDGED | RESOLVED

    - assignedToId: nullable -> User.id

    - assignedById: nullable -> User.id

    - instructions

    - acknowledgedById: nullable -> User.id

    - acknowledgedAt: nullable

    - resolvedById: nullable -> User.id

    - resolvedAt: nullable

    - completionNote: nullable until completion

5. AuditLog

    - id

    - actorId -> User.id

    - action

    - targetType

    - targetId

    - created_at: database timestamp (API/schema naming uses snake_case)

6. AuthSession (auth_sessions)

    - id, user_id, expires_at, revoked_at, created_at

7. CameraRoomCleanup (camera_room_cleanup)

    - id, device_id, publishing_session_id, created_at

    - Unique device/publication pair; worker retries room deletion.

8. CameraResponderRevocation (camera_responder_revocations)

    - id, device_id, publishing_session_id, responder_id, created_at

    - Unique device/publication/responder tuple; worker retries participant removal.
