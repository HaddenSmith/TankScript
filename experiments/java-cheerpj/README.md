# CheerpJ / Java 21 experiment

This is a local technical evaluation, separate from TankScript's production app.
It does not import or change BattleEngine, the editor, existing runners, backend,
or MongoDB. Java remains disabled in the production language selector.

## Run

Requirements: Node 24+, Chrome, and JDK 21+ for building **our trusted bridge**.
No npm packages are needed. From the repository root:

```sh
node experiments/java-cheerpj/build-bridge.mjs
node experiments/java-cheerpj/server.mjs
```

Open the first URL printed by the server. Choose the separate-host worker and
allow JavaScript JIT in the experiment frame, then start, compile, and run ticks.
Opaque-origin and stricter CSP settings are included for comparison, not assumed
to work. Stop worker cancels execution from outside the JVM.

On Windows the bridge builder detects `C:/Program Files/Java/jdk-25`. Otherwise,
use Java tools on PATH, or set `TANKSCRIPT_EXPERIMENT_JDK` to a JDK directory.
The generated bridge is ignored by Git. Only `java/ExperimentBridge.java` is
compiled locally. **Player `MyTank.java` is compiled by OpenJDK javac 21 in the
browser**, with `--release 21`, `-proc:none`, an in-memory file manager and class
loader. No compilation endpoint exists on the server.

For repeatable browser checks and measurements:

```sh
node experiments/java-cheerpj/smoke.mjs
node experiments/java-cheerpj/smoke.mjs ui
node experiments/java-cheerpj/verify.mjs
```

`smoke.mjs isolated` runs only the separate-host smoke check; `smoke.mjs ui`
exercises the actual Start/Compile/Tick/Stop controls. The verifier uses a
fresh disposable Chrome profile, runs 1/4/12 independent JVM workers, and writes
`results/measurements.json` and a screenshot. It also exercises compiler errors,
stateful ticks, guest Java probes, hanging tick/constructor/static initializer,
and startup cancellation. See `REPORT.md` for the observed results and limits.
Set `TANKSCRIPT_EXPERIMENT_CHROME` to a Chrome executable if needed on another OS.

## Isolation and test data

- The dummy application binds only to `127.0.0.1`; execution binds only to
  `127.0.0.2`, with random ports. These are different hosts, not just different
  ports: cookies are not isolated by port.
- The dummy application seeds clearly named fake cookies, local storage and
  IndexedDB. `/private/account` and `/probe` record only dummy local attempts.
  Neither server loads or connects to the real TankScript backend.
- Each frame owns one classic Blob worker and a private `MessageChannel`.
  Source/origin checks authenticate the frame handshake. The outside supervisor
  applies request deadlines and terminates the worker on a hang.
- The experiment's frame has its own CSP. A comparison option permits
  `unsafe-eval` for CheerpJ's default JIT. Production security policies are
  untouched. Runtime networking is limited to CheerpJ 5.0 asset URLs and the
  experiment's public bridge-asset directory.
- `browserProbe()` is a deliberately powerful, diagnostic-only native method.
  Guest Java calls it to test worker-level browser capabilities. It is **not** a
  proposed production API; import restrictions are not the security boundary.
- Local probes do not establish zero network access: the runtime CDN is allowed
  by CSP. No guest probe targets an external site. A separate execution origin
  still has its own browser-backed storage; it must never host accounts or
  secrets. Read the report before considering production use.

One Java object is constructed per compiled program. `tick(Snapshot)` returns a
string action; the supervisor validates normal tank actions. Security fixtures
use raw diagnostic replies instead. This intentionally small interface does not
implement the full TankScript Java API or change any game rules.

## Files

- `server.mjs`: two loopback-only hosts, static allowlist, CSP, fake endpoints.
- `supervisor.js`, `frame.js`, `worker.js`: lifecycle, isolated worker, CheerpJ.
- `java/ExperimentBridge.java`: browser javac, diagnostics, in-memory bytecode,
  persistent tank and simulated snapshot.
- `tanks.js`: normal, invalid, probing and nonterminating Java examples.
- `index.html`, `app.js`, `experiment.css`: small standalone demonstration UI.
- `chrome.mjs`, `smoke.mjs`, `verify.mjs`: dependency-free browser test tools.

## Runtime and licensing

Built with [CheerpJ](https://cheerpj.com/), version **5.0**, initialized with
`version: 21`. It is loaded from the official
`https://cjrtnc.leaningtech.com/5.0/loader.js`. No proprietary runtime files are
vendored, redistributed in this repository, or fetched by the local server.
Only the browser's normal temporary cache contains downloaded runtime assets.

The [current licensing documentation](https://cheerpj.com/docs/licensing) allows
technical evaluation. Community public use has eligibility and attribution
conditions and uses CheerpJ's CDN. Business/application licensing, self-hosting,
redistribution, and offline deployment have separate terms. This experiment is
not approval for a future commercial or self-hosted deployment.

References: [initialization](https://cheerpj.com/docs/reference/cheerpjInit),
[library mode](https://cheerpj.com/docs/guides/library-mode),
[in-memory filesystem](https://cheerpj.com/docs/guides/filesystem),
[native methods](https://cheerpj.com/docs/guides/implementing-native-methods),
[architecture](https://cheerpj.com/docs/explanation/architecture).
