# TankScript tests

Tests use Jest with Babel to transform the project's existing JavaScript modules
and JSX for Jest. The application stays ES modules. React tests use React Testing
Library. API tests launch the existing Express entrypoint in a separate process
and send real HTTP requests with Supertest; they do not import or restructure
`backend/index.js`.

## Organization

- `unit/engine/` covers movement, bullets, collisions, and battle outcomes.
- `unit/tanks/` covers the TankScript API, TypeScript checking and compilation, QuickJS execution, and five official tank scripts.
- `unit/frontend/` covers user-facing authentication, the Battle page, Tank Editor, and Debugger.
- `browser/` exercises real QuickJS/Pyodide workers, Python isolation, and browser benchmarks.
- `integration/authentication.test.js` checks registration, validation, unique
  accounts, login, tokens, and logout using the real service and MongoDB.
- `integration/tankApi.test.js` checks tank CRUD, language validation, original TypeScript source persistence, legacy JavaScript defaults, response shapes, and MongoDB `_id` handling.
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
npm run test:python
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

The legacy executor uses `new Function()` for trusted fixtures and benchmarks.
The QuickJS suites cover Web Worker execution deadlines and resource limits.
The runner suite also executes mixed JavaScript/TypeScript battles and checks
compilation caching, cancellation, and timeouts. Compiler unit tests use the
installed TypeScript standard library and the real TankScript API definitions.
The legacy-data fixture only removes a language field from a specific tank in
the isolated test database so backward compatibility is tested against MongoDB.
The runner command includes the real Pyodide tests; `test:python` runs those
alone. During `npm run dev`, open `/tests/browser/python-runner.html` to check
Python execution, mixed-language battles, CSP isolation, hard timeouts, restart
recovery, and frame cleanup in a browser. Its sources are test-only and are not
included as pages in the production build.

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
