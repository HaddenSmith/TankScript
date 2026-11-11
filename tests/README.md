# TankScript tests

Tests use Jest with Babel to transform the project's existing JavaScript modules
and JSX for Jest. The application stays ES modules. React tests use React Testing
Library. API tests launch the existing Express entrypoint in a separate process
and send real HTTP requests with Supertest; they do not import or restructure
`backend/index.js`.

## Organization

- `unit/engine/` covers movement, bullets, collisions, and battle outcomes.
- `unit/tanks/` covers the TankScript executor and five official tank scripts.
- `unit/backend/` covers the standalone runner and its subprocess protocol.
- `unit/frontend/` covers user-facing authentication and Tank Editor behavior.
- `browser/` exercises the real QuickJS Web Worker and runs browser benchmarks.
- `docker/` verifies the runner inside a restricted Linux container.
- `integration/authentication.test.js` checks registration, validation, unique
  accounts, login, tokens, and logout using the real service and MongoDB.
- `integration/tankApi.test.js` checks tank CRUD, validation, response shapes,
  and MongoDB `_id` handling.
- `integration/authorization.test.js` checks protected routes and tank ownership.
- `integration/mongodb.test.js` verifies user, token, and tank persistence across
  an Express backend restart.
- `helpers/` contains test-only adapters and Jest transforms.
- `runIntegration.js` creates and safely drops one uniquely named test database.

## Commands

Run from the repository root:

```sh
npm test
npm run test:unit
npm run test:engine
npm run test:frontend
npm run test:runner
npm run test:backend-runner
npm run test:backend-runner:docker
npm run test:integration
npm run test:coverage
```

`npm test`, `test:unit`, `test:engine`, `test:frontend`, and `test:coverage` do
not start the backend or connect to MongoDB. They exclude all of `tests/integration/`.

`npm run test:integration` requires the private `backend/dbConfig.json` Atlas
configuration. The runner generates and
sets `TANKSCRIPT_DB_NAME` before starting Jest or the backend, and refuses an
unsafe name. Tests also refuse to start the backend unless this environment
variable has the test-only prefix. Do not manually run integration suites without
the runner.

## MongoDB integration safety

Each run uses one 36-character `tankscript_test_<random-id>` database name,
within MongoDB's 38-byte limit. The only approved production-code change selects
`process.env.TANKSCRIPT_DB_NAME || 'tankscript'`; without the variable, normal
application behavior is unchanged. The runner drops only the exact name it
generated, in a `finally` cleanup path. It never searches for or removes older
test databases. If a run is forcibly interrupted or cleanup fails, the runner
reports the test database name; verify it manually before removing anything.
Credentials are read locally and never printed or written to test output.

The shared legacy executor uses `new Function()` for trusted fixtures. The
QuickJS Worker and Docker suites cover execution deadlines and resource limits.

## Adding tests

Put a test beside its category under `tests/`, name it `*.test.js` or
`*.test.jsx`, and test externally observable behavior. Keep examples and setup
small; use deterministic engine states and mock only network services or
dependencies that are not the subject of the test.

## Coverage

Jest failures include the failing assertion and source location; integration
startup failures indicate the service did not become ready or the local
configuration is unavailable. `npm run test:coverage` writes a text summary and
HTML report under `coverage/`; open `coverage/index.html` to inspect uncovered
game-engine and executor lines. The Express service runs in a separate process,
so its line coverage is not collected by Jest; HTTP integration tests verify its
observable behavior instead. Coverage is a diagnostic, not a target percentage.
