# TankScript Security Review

## Scope

This review considers TankScript source supplied by a user and executed by the current browser application. No exploit payloads were run and no application code was changed as part of the review.

## Finding

| Severity | File | Issue |
|---|---|---|
| Medium | `src/game/tank-script/tankScriptExecutor.js:2-37` | TankScript is arbitrary JavaScript executed in the application's main browser realm using `new Function`. |

The executor passes action functions and read-only state as named parameters, but those parameters only describe the intended interface. They do not restrict what JavaScript can access. The function runs synchronously in the same realm as the React application, so a script can potentially access `globalThis`/`window`, `document`, browser APIs, same-origin `localStorage`, and `fetch`. It can also modify shared built-in prototypes or global state, affecting other scripts and application code.

The first-command behavior in `src/game/tank-script/tankScriptApi.js` limits only which game action is recorded. It does not limit the rest of the script's execution. Similarly, frozen state snapshots protect the supplied data from ordinary mutation; they do not provide a security boundary around the rest of the page.

### Potential impact

- Read or alter same-origin local storage, including saved tank data. The Battle page loads tanks from multiple local `tanks:*` keys for opponent selection, so code supplied as an opponent may run in the page viewing it.
- Read or change page content and application state through DOM and browser globals.
- Make requests through browser networking APIs, subject to normal browser origin and policy restrictions.
- Interfere with shared prototypes, globals, event handlers, or timers, disrupting later scripts and the application.
- Run an infinite loop synchronously and freeze the page. The engine's exception handling cannot interrupt a non-terminating script; there is no execution-time or memory budget.
- Execute arbitrary JavaScript beyond the documented TankScript actions and state.

### Context and mitigation direction

For a local CS 260 prototype with trusted code on one user's own browser, the issue is an important limitation to document and avoid presenting as sandboxed. The current local username/localStorage model is not a security boundary between authenticated users.

For a real multi-user product, running another user's tank code in a viewer's application page can expose that viewer's same-origin data and compromise the page. Do not treat parameter hiding, `Object.freeze`, or API wrappers as sandboxing. A safer direction is a restricted domain-specific language or interpreter. If JavaScript must be supported, execute it in a genuinely isolated and resource-limited environment with a narrow message-based interface and no access to application credentials, storage, DOM, filesystem, or unrestricted network. A browser Worker by itself is not a complete security boundary.

Moving execution to a backend does not make `new Function` safe. It changes the target: arbitrary code could attack server data, credentials, filesystem, network, and other tenants. Backend execution would require a separate hardened sandbox, strict CPU/memory/time limits, and least-privilege isolation from application services and secrets.

## Priority

### Must address before executing other users' code on a real server

- Do not run untrusted TankScript with `new Function` in the application page or in the backend application's own process.
- Establish a real execution isolation boundary, resource limits, and a narrow input/output protocol before accepting or executing scripts from other users.

### Worth improving for the class project

- Clearly label the current executor as a trusted-code prototype, not a sandbox.
- Avoid testing scripts that are not trusted, since they can freeze or alter the current browser page and same-origin storage.

### Safe to postpone

- Production-grade multi-tenant execution can wait while the project remains a local prototype with trusted scripts, provided the limitation is understood and documented.
