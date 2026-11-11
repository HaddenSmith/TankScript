# Server-hosted battles

For local development on Linux with the validated Docker configuration, build the runner from the repository root.

```sh
docker build -f backend/tank-runner/Dockerfile -t tankscript-runner:local .
TANKSCRIPT_BACKEND_BATTLES=1 npm run dev:backend
# In a second terminal
VITE_TANKSCRIPT_BACKEND_BATTLES=1 npm run dev
```

PowerShell uses `$env:TANKSCRIPT_BACKEND_BATTLES = '1'` or `$env:VITE_TANKSCRIPT_BACKEND_BATTLES = '1'` in the respective terminal before starting npm. The backend binds to loopback in hosted mode. The deployment script builds the frontend with browser-hosted battles selected. The Express routes require their own explicit opt-in. When either mode is unavailable, the client displays the reported error.

## REST interface

All enabled routes use the existing authentication cookie. An account can read and control only its own battles. Community IDs follow the existing authenticated community catalog policy. The server looks up the saved source, name, and color for each selection.

| Request | Success |
| --- | --- |
| `POST /api/battles` | 201 with the initial session |
| `GET /api/battles/:id` | 200 with the latest session |
| `GET /api/battles/:id/updates?since=1` | 200 with ordered updates or a replacement snapshot |
| `POST /api/battles/:id/pause` | 200 with the paused session |
| `POST /api/battles/:id/resume` | 200 with the resumed session |
| `PATCH /api/battles/:id` | 200 with the new speed |
| `DELETE /api/battles/:id` | 204 after cleanup |

An example start request body follows.

```json
{
  "participants": [{"type": "official", "id": "easy"}, {"type": "official", "id": "medium"}],
  "arenaSize": 8,
  "startingHealth": 3,
  "speed": 0.125
}
```

The session contains `id`, `sequence`, `phase`, `speed`, `state`, and `error`. For example, an initial session has `sequence: 1`, `phase: "running"`, and `state.tickCount: 0`. The state also contains arena data, up to 50 feed messages, and the engine's final result when available. `PATCH` accepts `{"speed": 0.25}`. A current cursor returns `{"updates":[],"resync":null}`. Each update contains a session under `battle` and its animation `effects`. A cursor outside the retained range returns the latest session under `resync`. Errors use `{"code":"BATTLE_CAPACITY","msg":"…"}` with the corresponding HTTP status.

## Scheduling and capacity

The server starts one container, compiles each tank once, and schedules batches independently of polling. Each batch reads one pre-tick snapshot and the shared engine applies its commands together. Pausing holds a batch already in progress. Resuming applies the held batch once. Speed changes affect scheduling, and slow batches extend the tick interval. A tank-level error skips that tank's action and appears once per error type in the feed. A runner failure ends the session.

The manager defaults to one active battle, including startup and cleanup. Settings allow 2–12 tanks depending on arena size, 1–5 HP, and 125 ms to 1 s target intervals. Other limits include a 4 KiB request body, a start deadline of 18 seconds plus any outstanding Docker cleanup, 270 seconds of session time, and 30 seconds without a client request. The shared engine retains its 1,000-tick and stalemate rules. The manager keeps 24 updates and up to 12 completed sessions for two minutes. Sessions live in memory and disappear on restart. Request limits apply before authentication and per authenticated account.

The client uses sequential polling, backs off on connection failures, and replaces stale state when the server requests resynchronization. Reset and navigation abort local requests and request server cleanup. A startup disconnect cancels the pending request when Express detects it. The idle deadline covers disconnects that the server cannot observe immediately.

## Deployment requirements

The launcher uses the existing restricted Docker runner. Express must not be added to a production host's Docker group for this feature. Control of a conventional Docker daemon can grant host-level privileges. Before enabling public execution, use a dedicated credential-free execution host or a narrowly authorized launcher separated from the public web process. Confirm the isolation settings and measure capacity on the intended host. The 384 MiB and one-CPU cap applies per active container. Previous Linux benchmarks showed that bullet-heavy 12-tank battles exceed a 125 ms interval, so concurrency and supported workloads need host-specific limits.

Keep the UI and API on one origin. The reverse proxy needs to preserve the original Host header for the mutation checks. Vite already does this for local development.

Normal stop and process shutdown wait for runner disposal. Configure a process-manager shutdown grace period long enough for Docker and database cleanup before enabling the feature. The periodic sweep removes only aged, never-started containers matching the runner's image, label, and name. It uses exact container IDs and regular removal. A failed forced removal blocks further starts in that process. Verify the affected runner's removal before restarting it. The runner's independent lifetime limit bounds a container that loses its controller.
