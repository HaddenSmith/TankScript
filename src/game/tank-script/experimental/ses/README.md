# SES + Web Worker TankScript experiment

This is an isolated browser experiment. It does not change `BattleEngine`,
`executeTankScript()`, React gameplay, or the QuickJS prototype. SES 2.3.0 is
loaded and locked down in a dedicated worker, never in the application realm.

## Run the browser lab

```sh
npm run ses:lab -- --port 4173
```

Open
`http://127.0.0.1:4173/src/game/tank-script/experimental/ses/browser-lab.html`
and select **Run browser tests and benchmarks**. The dangerous execution cases
run only in disposable workers. The browser lab also runs the existing
production executor and QuickJS against the same controlled snapshots and
assembled official tank code.

The existing QuickJS checks remain available with `npm run test:quickjs`, and
its Node benchmark remains `npm run bench:quickjs`.

## Runner and isolation model

```js
import { createSESTankRunner } from './sesTankRunner.js';

const runner = await createSESTankRunner(tankCode, {
  executionTimeMs: 100,
});
try {
  const command = await runner.runTick(tankState);
} finally {
  runner.dispose();
}
```

Each runner owns one reusable module worker and one SES `Compartment`; use one
runner per tank. The worker calls `lockdown()` before accepting messages. The
compartment receives no endowments: the worker serializes each host state
snapshot as JSON, and the compartment parses and recursively freezes its own
copy. Tank code is compiled inside that compartment with the existing state
arguments and seven actions. Its action closures and first-command collector
are also created inside the compartment, so no application callback or
host-owned object crosses the boundary. A result crosses back as a JSON string
and is validated against the existing `{ action }` shape.

The compartment's `globalThis` is not the worker's global object. It has no
DOM, storage, network, application, or worker messaging capabilities. There
are no module descriptors or import hooks; SES rejects dynamic `import()`
expressions. `eval` and `Function` are available as SES-confined evaluators:
the tests verify that constructors resolve only to the compartment global,
not the worker or application global. `lockdown()` freezes shared intrinsics
against prototype mutation.

SES disables `Math.random()` by default because random state can be a
cross-compartment communication channel. TankScript's official tanks use
randomness, so this experiment installs a small seeded PRNG on a compartment-
local `Math` facade. The seed comes from the worker's crypto API, but the
generator itself is not cryptographic. This preserves the existing call shape,
not the exact random stream of the production executor or QuickJS; therefore
randomized tank decisions can differ.

The main thread owns the timeout. On timeout it calls `Worker.terminate()`,
rejects the tick with `EXECUTION_TIMEOUT`, and starts a fresh worker and
compartment on the runner's next tick. Runtime exceptions are reported without
discarding the worker, matching the existing behavior of continuing to run a
tank after a failed tick. The runner is asynchronous; an engine integration
would need to await all living tanks' command promises before resolving that
tick's simultaneous movement. This experiment intentionally does not make
that BattleEngine change.

### Limits and caveats

- SES compartments are not separate operating-system processes and have no
  built-in memory quota. A worker can consume enough memory to harm or crash
  the browser process before the main thread's timer runs. The lab verifies a
  bounded 32 MiB allocation in a worker; it deliberately does not attempt
  unbounded allocation.
- Worker termination provides a hard stop only after the main event loop gets
  a chance to run the timeout callback. Browser throttling, a blocked main
  thread, or suspension can delay it.
- The worker is a separate JavaScript agent from the UI, but remains in the
  same browser application and origin. Browser/SES defects and dependency
  supply-chain compromise are not addressed by these tests.
- `globalThis` inside the compartment is mutable, so a tank can keep its own
  globals between ticks. Tanks do not share workers or compartments.
- Browser APIs do not expose reliable per-worker memory usage. The reported
  `performance.memory` deltas are for the main thread and are noisy; QuickJS
  reports its own limited heap.
- User code that is valid JavaScript but contains dynamic `import()` is
  rejected by SES. No official tank uses it.

## Browser checks

The browser lab verifies:

- No `window`, `document`, storage, network, worker, Node, or named application
  globals are reachable through the compartment.
- State snapshots are independent, recursively frozen copies.
- Attempts to change `Object.prototype` and `Array.prototype` do not modify
  the shared intrinsics.
- `globalThis`, `eval`, `Function`, and constructor-based dynamic code remain
  confined to the compartment.
- SES rejects dynamic module imports; first-action and early-return behavior
  match `createTankScriptApi()`.
- Tick-local variables reset; worker globals do not leak between tanks.
- Invalid source, repeated exceptions, recursion failure, a nonresponsive
  infinite loop, and a long computation are handled in workers. A timeout
  terminates the worker, another tank continues, and the timed-out runner
  recovers on its next tick.
- A bounded 32 MiB allocation is exercised only in a worker and its worker is
  then terminated.
- All five assembled official tank programs run with the current state API and
  shared tactical helpers. A deterministic script is also checked against all
  three executors for exact command equality.

On the measured browser run, the infinite-loop timeout returned in 103.9 ms
for a configured 100 ms limit; the main-thread heartbeat continued 10 times,
and another tank completed while the stuck worker was terminated. This is one
run, not a hard real-time guarantee.

The official tank command comparison is observational because `Math.random()`
is not seeded identically in all three executors. In the recorded sample,
Firefly returned `rotateLeft` in the production executor and `shoot` in
QuickJS and SES. Bloodhound, Sidewinder, Prism, and Checkmate returned the
same action across all three. This is a random-stream difference, not a
TankScript API or movement-rule change.

## Browser benchmark

Measured in the integrated browser (Chrome 150 / Electron 43) on 2026-11-04
with Vite 8.3.1, SES 2.3.0, and QuickJS 0.32.0. Each sample uses 100, 500, or
1,000 successive state snapshots captured from the existing `BattleEngine`;
all three executors get the same snapshots. Each snapshot contains all tanks
and bullets. The five official tank scripts are assembled with the same shared
helper source used by the game. Dead tanks are skipped, which is why the count
of actual commands is less than five times the tick count. The battle states
and commands can vary between runs because the official scripts use
randomness.

| Ticks | Requested tank runs | Actual commands | Existing executor CPU | QuickJS CPU | QuickJS chunked wall | SES worker wall |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 500 | 380 | 110.5 ms | 3,448.5 ms | 3,553.7 ms | 683.2 ms |
| 500 | 2,500 | 1,810 | 486.1 ms | 16,534.9 ms | 17,240.6 ms | 2,995.4 ms |
| 1,000 | 5,000 | 3,576 | 949.8 ms | 29,952.2 ms | 31,425.1 ms | 5,326.6 ms |

QuickJS wall time includes short yields between batches so the page can
respond; its CPU column excludes those yields. SES wall time includes JSON
serialization, worker messaging, queueing, and execution, but not initialization.
The approximate 1,000-tick result including startup was 5.41 seconds for SES.
On this run SES was about 5.9 times faster than QuickJS's chunked browser wall
time, but about 5.6 times slower than the existing synchronous executor's CPU
time. These are measurements from one browser and are not portable performance
promises.

Initialization across all five runners was 7.5 ms for QuickJS and 85.7 ms for
SES. For SES, per-worker startup/readiness ranged from 66.2 to 82.6 ms, and
compilation ranged from 2.1 to 3.4 ms. The 1,000-tick SES sample spent 48.8 ms
serializing state, 5,591.0 ms in worker execution summed across the five
workers, and 5,326.6 ms wall-clock across all simultaneous runners. The summed
per-tank worker execution was:

| Tank | Worker execution over the 1,000-tick sample |
|---|---:|
| Firefly | 25.3 ms |
| Bloodhound | 29.9 ms |
| Sidewinder | 218.4 ms |
| Prism | 349.4 ms |
| Checkmate | 4,968.0 ms |

The large Checkmate cost reflects its bounded multi-step tactical search on
these changing snapshots. QuickJS used 479,404 bytes of interpreter heap after
the sample (its configured limit is per runtime). SES worker memory could not
be measured reliably with browser APIs. Main-thread heap deltas fluctuated
negative during garbage collection and are not useful as memory comparisons.

The timings include worker startup and messaging rather than hiding those
costs. SES shows a substantial improvement over QuickJS in this workload, but
is still slower than the current executor. The worker messaging and
initialization overhead are especially visible for small battles.

The existing Node benchmark was also run with `npm run bench:quickjs`. It
measured only the existing executor and QuickJS; SES requires the browser
worker lab above:

| Ticks | Existing executor | QuickJS reused runtime | QuickJS slowdown |
|---:|---:|---:|---:|
| 100 | 96.56 ms | 4,094.33 ms | 42.40× |
| 500 | 339.39 ms | 12,601.57 ms | 37.13× |
| 1,000 | 779.29 ms | 31,847.45 ms | 40.87× |

QuickJS heap usage after these Node samples was 479,020–479,404 bytes across
five runtimes, with a combined configured limit of 80 MiB. The browser and
Node results differ; neither should be generalized to other devices.

## Comparison and recommendation

| Dimension | Existing `new Function()` | QuickJS prototype | SES + Web Worker prototype |
|---|---|---|---|
| Security isolation | None. Player code executes in the app realm with ambient browser and application access. | Separate QuickJS VM/context; no browser globals or application callbacks. Not a process boundary. | SES `lockdown()` and a compartment inside one dedicated worker per tank; only serialized state and local action functions are supplied. Not a process boundary or a guarantee against engine defects. |
| Infinite loops | No limit; blocks the app. | QuickJS interrupt/time budget stops execution, but synchronous execution blocks the calling thread until the interrupt. | Main-thread timeout terminates the worker and runner can restart. Timer delivery can be delayed if the main thread is blocked or suspended. |
| Memory exhaustion | No limit. | Explicit QuickJS heap and stack limits. | No per-worker JavaScript heap limit; a worker can still exhaust browser-process memory. |
| Performance | Fastest in the browser run; untrusted and synchronous. | Slowest in this browser run; approximately 34× the existing executor CPU for 1,000 sample ticks. | Approximately 5.8× faster than QuickJS wall time here, but approximately 6.1× slower than the existing executor CPU. Includes worker and messaging overhead. |
| Complexity | Small, synchronous API. | WASM runtime lifecycle, handle disposal, compile and execution limits. | SES lockdown, module worker lifecycle, asynchronous command collection, worker restart/error protocol, JSON boundary, and no heap cap. |
| TankScript compatibility | Current API and globals, but no sandbox. | All five official scripts pass the existing QuickJS tests. | All five official scripts submit valid actions. Random decisions can differ; SES rejects dynamic `import()`. |
| Server-side path | Unsafe for untrusted code. | QuickJS can run in Node; add worker isolation and retain explicit heap/time limits. | SES itself supports Node, but this worker runner is browser-specific and SES does not provide a memory quota. A server would still need process-level resource controls. |

**Recommendation: postpone production migration.** SES + workers is a promising
latency improvement over this QuickJS prototype and does keep synchronous
player execution off the UI thread, but it does not cap memory. That is a
material risk for arbitrary player-submitted code. If a browser-side migration
becomes necessary, first compare QuickJS inside a dedicated worker: it combines
worker termination with an explicit interpreter heap/stack budget, at a
significant measured speed cost. For genuinely hostile multi-user scripts,
consider an out-of-process execution service with operating-system resource
quotas rather than treating either browser sandbox as completely secure.

No BattleEngine changes are made here. A future integration would make command
collection asynchronous, wait for the results of every living tank before the
existing simultaneous movement and collision phases, handle per-tank timeouts
and failures explicitly, and terminate workers when a battle ends.
