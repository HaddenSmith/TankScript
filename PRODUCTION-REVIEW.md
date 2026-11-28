# TankScript production review

Reviewed November 27, 2026, locally on Windows with Node 24.21.0, npm 12.2.0 and Chromium 158.0.8127.36.
No production server or application database was modified.

## Recommendation

**GO for a controlled update of the existing hobby site, after the server preflight below.**
No blocking gameplay, persistence, isolation, or release-packaging regression was reproduced.
The remaining security and resource limitations are explicit below. This review does not certify
the live Caddy/PM2 configuration or provide hard browser memory containment.

## Code and UI findings

- Keep the separate Arena arrays and engine-owned rules. At the current 8×8–20×20 arena sizes and
  12-participant limit, this review found no reason to introduce a grid or another execution architecture.
- React renders copied engine state. Pause/resume retains the pending command batch, resolves it once,
  and advances Lightning only through engine ticks. Reset/navigation invalidate old requests and effects.
- Living walls, uncollected pickups, health/status fields and each bullet's captured speed flow through
  the shared read-only scripting snapshot. JavaScript/TypeScript and Python agree on values, with
  snake_case names in Python. Local-name shadowing and saved legacy JavaScript remain supported.
- Simultaneous damage, shared kills, wall blocking/destruction, capped healing and Lightning's
  tick-based countdown are preserved. A follow-up changes Lightning to N+1 through N+30
  and replenishes missing pickups every 75 ticks. Existing bullets retain their fired speed.
- The Debugger remains a static command tester, including placement, dragging, keyboard interaction,
  inspection, cancellation and accurate object snapshots. It does not run battle simulation.
- Worker cleanup, bounded compilation caches, snapshot size validation and first-action-wins remain
  in place. No engine or language-runner refactor was needed. No unused dependency removal was justified.
- Registration retains 7–128 characters with no required character categories. React requires matching
  confirmation; Express also checks it when provided by a client. Passwords use bcrypt cost 10.
  Authentication/ownership guards, unique account indexes, permanent saved languages and legacy
  JavaScript defaults passed real API tests. JSON account/tank responses exclude password hashes,
  session tokens and MongoDB IDs; the session token is sent in its protected cookie.
- Battle Setup now groups Walls and Power-Ups in two compact cards, stacked on mobile. Both settings
  remain independent and off by default. Detailed spawning rules remain in the API Reference.
- About describes the actual three-language editor, Debugger, community/official tanks, tick model,
  walls, pickups and settings, including the BYU CS 260 origin and ongoing hobby-project history.
- Oversized JSON now returns 413 with a safe message instead of 500. The counter's WebSocket endpoint
  now accepts at most 1 KiB per incoming message, retaining its ping/pong heartbeat and broadcasts.
- Environment files and private key files are ignored by Git. A tracked-file pattern scan found no
  concrete MongoDB credential URI, AWS access-key ID or private-key block. Git history was not audited.

## Verification

| Check | Result |
| --- | --- |
| Complete Jest suites | 562 tests, 38 suites passed |
| Authentication/database/API/WebSocket integration | 50 tests, 6 suites passed |
| Real QuickJS/Pyodide, TypeScript compiler and Java production gates | 72 Node tests passed |
| Production build | Passed with Vite 8.3.8 |
| Offline deployment package and standalone backend install | Passed |
| Packaged production server | Health, frontend, private-path rejection, tank API, Java rejection and WebSocket broadcast passed |
| Whitespace checks | `git diff --check` passed |

Integration and full account-browser tests used uniquely named `tankscript_test_...` databases,
removed in cleanup. The standalone backend manifest/lockfile matched exactly and installed
82 production packages without the root workspace. No database migration is introduced.

A final Windows packaging retry encountered a native Rolldown file held by a running local Vite
process. Dependencies were restored without changing the reviewed lockfile, and the final archive
was built and smoke-tested from a clean temporary source copy. The existing local server was left
running. Stop local Vite/preview processes before a clean install in that same directory on Windows.

Chromium exercised registration, login/logout/session restoration, all three languages' tank CRUD,
drafts/starters/autocomplete, compiler diagnostics, static Debugger scenarios, legacy tanks, Java gates,
mixed battles, pause/reset/completion, multi-tab WebSocket broadcasts and reconnection. Additional
browser checks cover wall/pickup combinations, healing, faster bullets, Lightning expiration, repeated
cleanup and read-only arena data. The worker lab checks opaque origin, restrictive CSP, cooperative
and external timeouts, healthy peers and cancellation. Expected deliberately triggered script errors
are distinguished from React errors and unexpected resource failures.

Layouts were checked at 1280, 768 and 390 pixels; the API Reference also at 1440 pixels, with a very
long editor line. No page-wide horizontal overflow was observed. These are desktop Chromium viewport
checks, not physical-device, Firefox or Safari verification. Generated reports, archives, installed
test packages, screenshots and `dist/` are removed after review.

## Dependencies and remaining risks

| Priority | Finding | Required follow-up |
| --- | --- | --- |
| Server preflight | Live Node/PM2/Caddy, TLS, proxy/security headers and backups were not accessed. | Verify the actual server configuration before deploying. Local tests cannot establish its state. |
| Medium | Express has no login/registration rate limiting or explicit server-side session expiration; the secure, HttpOnly, SameSite=Strict cookie lasts one year. | Verify edge abuse protection and plan application/session hardening before wider exposure. Existing accounts and authentication rules were preserved. |
| Medium | Python has no enforced per-tank heap quota; allocations can exhaust a tab despite origin isolation and external termination. | Retain the documented limitation and consider conservative Python concurrency/resource controls before broader use. Java stays disabled publicly. |
| Medium | The current 7–128-character password policy permits inputs beyond bcrypt's 72-byte UTF-8 limit. Hash verification ignores bytes beyond that limit. | Review a compatible password-storage/validation migration separately; do not invalidate existing hashes by silently changing login hashing. |
| Moderate, tooling | 18 affected Jest/coverage packages remain in the full audit, rooted in glob/minimatch advisories. | Review an upstream toolchain update separately. Do not force unsupported dependency overrides or the audit's proposed major downgrade. These packages are absent from the deployed backend package. |
| Low, frontend | Monaco 0.57.0 embeds affected DOMPurify 3.4.15. The audit reports two affected production packages including Monaco. | Review stable Monaco 0.58.0 separately. 0.57.1 is not published on npm; updating only `node_modules/dompurify` does not replace Monaco's embedded file. |

Vite was patched from 8.3.1 to 8.3.8, its Rolldown dependency from 1.2.11 to 1.2.19, and
source-map-js from 1.2.1 to 1.2.4, with the compatible dependencies required by those patches.
The full audit changed from 22 affected packages (2 high, 18 moderate, 2 low) to 20 (0 high/critical,
18 moderate, 2 low). The standalone backend production audit reports zero findings.
No top-level major or prerelease upgrade was applied. Existing Babel peer warnings remain;
clean installation, compilation and tests succeeded.

Monaco 0.58.0 upgrades the embedded sanitizer to 3.4.17 and documents editor behavior changes.
The reviewed 0.57 renderer does not configure the IN_PLACE, XML parser or SAFE_FOR_TEMPLATES modes
in the reported DOMPurify issues; this is limited source inspection, not proof of non-exploitability.
Sources: [Monaco changelog](https://github.com/microsoft/monaco-editor/blob/main/CHANGELOG.md),
[DOMPurify advisories](https://github.com/cure53/DOMPurify/security/advisories),
[Vite advisories](https://github.com/vitejs/vite/security/advisories),
[source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q),
[glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4),
[minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249),
[bcrypt byte limit](https://github.com/dcodeIO/bcrypt.js#security-considerations).

## Deployment preflight

1. Review and commit the intended changes yourself. This review did not commit, push or deploy.
2. Use the locked packages (`npm ci`), run the tests and build, and optionally inspect a local archive:
   `bash deployWebsite.sh -o /path/to/new-release.tar.gz`. Offline mode does not use SSH.
3. Keep `backend/package.json` and its standalone `backend/package-lock.json` together. The deployment
   copies them to the release root and installs with `npm ci --omit=dev --ignore-scripts`.
   The backend files live under `backend/`; the stable root `index.js` forces production mode.
4. On the server, verify a supported Node version, PM2 fork mode with one `startup` process and the
   stable service directory/entry point, plus a valid private MongoDB configuration owned by the service
   user with mode 400 or 600. Verify the intended database, its backups and available EC2 disk/RAM.
5. Validate the actual Caddy configuration, HTTPS and forwarding of frontend routes, `/api` and `/ws`
   to the loopback Express port. Inspect effective security/cache headers and verify compatibility with
   the existing Python frame policy. Keep the development server private; preserve existing isolation.
6. Confirm the public archive contains only the generated frontend, notices/logos and selected backend
   files/manifests. The inspected 132-entry archive contained no credentials, tests, coverage output,
   experiments, node_modules or Java compiler/classlib/runtime assets.
7. After a deliberate deployment, check `/api/health`, login and existing saved tanks, cold Python
   loading, a mixed battle, and WebSocket reconnect/online count through HTTPS. Verify Java remains
   disabled even if the development flag is present. These live checks remain the deployer's work.
8. Keep the previous release available for the existing `-r` rollback. Rollback restores files, not
   database contents. Normal updates do not need the historical first-migration `-m` option.

A failed server preflight is a **NO-GO** until resolved. The listed low/tooling findings and optional
future UI/architecture changes are not evidence of a current deployment failure. A larger public
launch should separately resolve the medium-risk abuse, session and browser-resource decisions.
