# TankScript safe-execution experiments

This directory records exploratory work on running player-authored TankScript
code with better isolation. It is not a production sandbox and is not wired
into the game. The production executor and `BattleEngine` remain unchanged.
The QuickJS and SES prototype-specific documentation has been kept alongside
the code; this README is the central index and summary.

The findings and measurements below describe the current
`feature/sandboxed-tank-execution` branch and specific local test runs. They
are evidence about these implementations, not a proof that either sandbox is
secure against every attack.

## 1. Why investigate sandboxing?

TankScript lets each tank choose an action from public arena information. The
five built-in tanks are examples of community-authored scripts, and player
scripts can be supplied as JavaScript code. The current executor constructs a
JavaScript function with `new Function()` and calls it in the application's
JavaScript realm.

That is a code-execution feature, not a security boundary. Code running there
can access ambient browser globals such as `window`, `document`, browser
storage, and network APIs; inspect or interfere with application state that is
reachable from the realm; modify mutable shared prototypes; and perform
operations beyond the documented TankScript API. An infinite loop or
excessively expensive computation runs synchronously and can make the page
unresponsive. Catching a thrown exception does not prevent those capabilities
or stop a loop.

There are two different concerns:

1. **Browser execution security:** limit what a script can access or damage,
   keep a stuck script from freezing the UI, and control its resource use.
2. **Competitive integrity:** prevent a participant from gaining an unfair
   advantage, falsifying a result, or violating game rules.

A sandbox may reduce the first risk without solving the second. For example,
isolating a script does not make its decisions fair, prevent a client owner
from modifying their own client, or make client-reported battle results
trustworthy. Server-authoritative game simulation and validation address
competitive integrity; sandboxing untrusted code is a separate execution
security problem.

## 2. Existing production executor

Production execution lives in
[`tankScriptExecutor.js`](../tankScriptExecutor.js). For each execution it
constructs a function with `new Function()` and passes the documented action
functions and state values as arguments. The state API is:

- Actions: `moveUp()`, `moveDown()`, `moveLeft()`, `moveRight()`,
  `rotateLeft()`, `rotateRight()`, and `shoot()`.
- State: `tankId`, `tankPosition`, `tankRotation`, `tankHealth`, `allTanks`,
  `allBullets`, `arenaWidth`, and `arenaHeight`.
- Commands have the shape `{ action }`. The first action called in one tick
  wins; later action calls are ignored, though the script continues running.

[`tankScriptApi.js`](../tankScriptApi.js) defines the first-action behavior.
[`BattleEngine`](../../engine/battleEngine.js) currently calls scripts
synchronously while collecting the living tanks' commands; it then resolves
the simultaneous movement and continues the tick. Its state snapshots and
nested tank/bullet arrays are frozen before execution. This is useful against
ordinary accidental mutation, but freezing snapshots is not a sandbox and
does not remove ambient browser capabilities.

**Strengths:** small and fast; preserves ordinary JavaScript behavior and
existing scripts; no worker startup, serialization, or asynchronous engine
coordination.

**Limitations:** no isolation, time limit, memory limit, or protection against
infinite loops. `new Function()` does not make untrusted code safe: its code
still executes in the current realm and can reach that realm's globals.

In the recorded Chrome browser sample, the existing executor took about
110.5 ms for 100 ticks, 486 ms for 500, and 950 ms for 1,000. These runs
measured command collection over the five official scripts, including
constructing the function each time a living tank ran. See
[Performance comparison](#5-performance-comparison) for the full context.

## 3. QuickJS prototype

The prototype uses
[`quickjs-emscripten`](https://www.npmjs.com/package/quickjs-emscripten)
(`0.32.0` in the recorded run) to execute scripts in a separate QuickJS
runtime/context. It is an experiment only; the production engine still uses
the synchronous executor.

### How it works

[`quickjsTankRunner.js`](../quickjsTankRunner.js) initializes one QuickJS
runtime per runner, sets interpreter memory and stack limits, and compiles the
tank code once. Each `runTick(state)` call serializes state through JSON,
parses it inside QuickJS, recursively freezes that copy, runs the player
function, and copies back a validated `{ action }` command. The VM receives no
application objects, host callbacks, or module loader. The prototype removes
some intrinsics, including `Date`, `Promise`, `Proxy`, `RegExp`, and typed
arrays. Its runner API is synchronous after initialization:

```js
import { createQuickJSTankRunner } from '../quickjsTankRunner.js';

const runner = await createQuickJSTankRunner(tankCode, {
  executionTimeMs: 100,
  memoryLimitBytes: 16 * 1024 * 1024,
  stackLimitBytes: 512 * 1024,
});
try {
  const command = runner.runTick(tankState);
} finally {
  runner.dispose();
}
```

Default limits are 100 ms execution time, 16 MiB of QuickJS heap per runtime,
and 512 KiB of stack. An interrupt handler enforces the execution budget;
QuickJS enforces its heap and stack limits. Errors have typed codes for
invalid source, timeout, memory limit, runtime failure, and disposed runners.
The memory number applies to QuickJS's heap, not the WebAssembly module,
host-side serialization, or wrapper objects. Five runners can each use up to
their configured heap limit.

The API and state names match the production TankScript API listed above.
Every tick gets fresh function-local variables and a fresh frozen JSON state
snapshot; intentional writes to a runner's `globalThis` persist in that
runner's private runtime only. The first action wins, and early returns
preserve an action already submitted. The tests execute Firefly (Easy),
Bloodhound (Medium), Sidewinder (Hard), Prism (Expert), and Checkmate
(Overkill), including the shared `tacticalCode.js` helper used by the harder
tanks.

### Tests, performance, and limitations

[`quickjsTankRunner.test.js`](../quickjsTankRunner.test.js) covers all seven
actions, first-action and early-return behavior, state freezing, missing
browser/network/host globals, constructor confinement, independent runtimes,
fresh local variables, invalid code, an infinite loop, stack overflow, heap
exhaustion, and all five official tanks. The most recent recorded run passed
all 20 Node test cases.

[`benchmarkQuickJSTankRunner.js`](../../../../scripts/benchmarkQuickJSTankRunner.js)
compares the production executor and reused QuickJS runtimes over 100, 500,
and 1,000 successive snapshots captured from the real `BattleEngine`. Its
timed region is command collection, not simulation, rendering, or movement
resolution. The Node results and the separate browser results are in the
performance section.

QuickJS was substantially slower than the existing executor in these tests
(around 38–42 times slower in the latest Node sample). In the browser sample
it was also much slower than SES. The direct QuickJS runner executes
synchronously on the caller's thread: its interrupt stops a loop only when
QuickJS reaches an interrupt check, so the browser may still be unresponsive
until then. A Web Worker would add an external hard-stop mechanism, but this
prototype does not implement a worker. QuickJS memory and stack limits are
valuable protections, but do not protect against bugs in QuickJS, WASM, or the
integration.

Prototype-specific details remain in
[`quickjsTankRunner.md`](../quickjsTankRunner.md).

## 4. SES + Web Worker prototype

The prototype uses the Endo project's maintained
[`ses`](https://www.npmjs.com/package/ses) package (`2.3.0` in the recorded
run). SES provides `lockdown()` and `Compartment`s. It is loaded and locked
down in a dedicated worker, not in the React application's realm.

### Worker, compartment, and messages

[`sesTankRunner.js`](./ses/sesTankRunner.js)
creates one reusable module worker per tank. The worker code is
[`sesTankWorker.js`](./sesTankWorker.js).
The worker calls `lockdown()` before handling messages and creates one SES
compartment for that tank. No endowments, host callbacks, module descriptors,
or import hooks are provided to the compartment.

The host serializes each tank's state to JSON and sends the string to the
worker. The compartment parses it into a separate object graph and recursively
freezes it. Tank code is compiled inside the compartment with the existing
TankScript state arguments and action names. The seven action closures and
first-action collector are created in the compartment; host-owned objects and
application callbacks do not cross into it. The compartment serializes its
optional `{ action }` result back to JSON, and the host validates that the
action is one of the existing seven actions.

The compartment cannot see the worker's global object. The tests verify that
the compartment has no `window`, `document`, storage, `fetch`, network,
application, Node, or worker messaging globals. SES hardens shared intrinsics
against prototype modification. `eval` and `Function` are not themselves
treated as proof of a vulnerability: SES confines their evaluators to the
compartment, and the tests check that constructor-based access reaches only
that compartment's `globalThis`. Dynamic `import()` is rejected by SES because
there is no permitted module loader; code containing it is incompatible even
if it would otherwise be valid JavaScript.

### Actions, timeout, and recovery

The runner's intended usage is asynchronous:

```js
import { createSESTankRunner } from './ses/sesTankRunner.js';

const runner = await createSESTankRunner(tankCode, { executionTimeMs: 100 });
try {
  const command = await runner.runTick(tankState);
} finally {
  runner.dispose();
}
```

The host owns the timeout. A nonresponsive worker is terminated with
`Worker.terminate()`, the request is rejected with a typed timeout error, and
the next tick creates a fresh worker and compartment. Other tanks have their
own workers and can continue. Runtime exceptions are reported for that tick
without restarting the worker, so a tank may continue on later ticks. A
timed-out worker's own globals and PRNG state are lost on restart.

Worker termination is stronger than an interpreter interrupt on the same
thread, but it is not a hard real-time guarantee: the main event loop must get
time to deliver the timeout, and browser throttling or suspension can delay it.
Integrating this runner would also make command collection asynchronous. The
engine would need to wait for all living tanks' responses before resolving the
same simultaneous tick. No `BattleEngine` changes have been made.

### Randomness, tests, and remaining risks

SES disables `Math.random()` by default because random state can act as shared
communication between compartments. Official tanks use randomness, so the
prototype installs a simple per-compartment seeded pseudorandom generator on
a compartment-local `Math` facade. The seed is obtained from the worker's
crypto API; the generator itself is not cryptographic. This preserves the
`Math.random()` call shape, not identical results across the production
executor, QuickJS, and SES. Randomized decisions can therefore differ.

[`browser-lab.js`](./browser-lab.js)
contains the browser security checks, compatibility comparisons, and browser
benchmark. Its security cases run in workers, never in the application
thread. The latest recorded browser run passed the checks for browser/network
and application globals, state snapshot immutability, shared prototype
modification, compartment confinement through `globalThis`/`eval`/`Function`
and constructors, dynamic-import rejection, first-action/early-return
behavior, fresh local variables, tank-to-tank isolation, invalid code,
repeated runtime exceptions, recursion failure, infinite loops, long
computations, and recovery. It also ran a bounded 32 MiB allocation in a
worker. A deterministic script returned the same action in all three
executors, and all five assembled official tank scripts returned valid
actions.

The timeout test used a 100 ms limit. In the latest recorded run it returned
in 103.9 ms, the main-thread heartbeat fired 10 times, a separate tank
completed, and the hanging worker was terminated. This is one measurement, not
a timing guarantee. The lab tests only a bounded memory allocation:

- **SES does not impose a JavaScript heap quota.** A worker can consume enough
  memory to harm or crash the browser process before the timer can help.
- A worker is a separate JavaScript agent, not a separate operating-system
  process or browser security origin. Browser/SES defects and dependency
  supply-chain compromise are out of scope for these tests.
- `globalThis` inside a compartment is mutable, so a tank can retain its own
  globals across ticks. Other tanks have separate workers and compartments.
- Browser APIs do not expose reliable per-worker memory usage. QuickJS's own
  heap figures cannot be directly compared with worker memory.
- Dynamic-import rejection and non-identical random streams are compatibility
  differences, not successful reproduction of the production runtime's
  behavior.

SES therefore improves responsiveness and isolation from ambient application
APIs in this prototype, but passing these tests does not prove it completely
secure or protect against memory exhaustion.

More detail and the recorded SES-only measurements are in
[`README.md`](./ses/README.md).

## 5. Performance comparison

### Browser run

The figures below are verified against the recorded browser lab results and
[`experimental/ses/README.md`](./ses/README.md). The run used
Chrome 150 / Electron 43 on 2026-11-04, Vite 8.3.1, SES 2.3.0, and QuickJS
0.32.0. All three executors ran the same successive state snapshots from the
existing `BattleEngine` with the five assembled official tanks. The snapshots
include all tanks and bullets. Dead tanks are skipped, so actual commands are
fewer than the requested five runs per tick. Official tanks use randomness;
state trajectories and counts can vary on a new run.

| Ticks | Requested tank runs | Actual commands | Existing executor CPU | QuickJS CPU | QuickJS wall | SES worker wall |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 500 | 380 | 110.5 ms | 3,448.5 ms | 3.55 s | 683.2 ms |
| 500 | 2,500 | 1,810 | 486.1 ms | 16,534.9 ms | 17.24 s | 3.00 s |
| 1,000 | 5,000 | 3,576 | 949.8 ms | 29,952.2 ms | 31.43 s | 5.33 s |

The CPU and wall columns are deliberately distinguished. QuickJS wall time
includes short yields between batches so the browser can respond; its CPU
column excludes those yields. SES wall time includes state serialization,
worker messaging, queueing, and execution across five concurrent per-tank
workers. At 1,000 ticks SES spent 48.8 ms in host state serialization and
5,591.0 ms in summed worker execution; summed worker time exceeds wall time
because workers run concurrently. SES wall time excludes worker initialization.
Adding the measured 85.7 ms initialization across five workers gives about
5.41 s for the 1,000-tick sample. QuickJS initialized all five runtimes in
7.5 ms; the existing executor has no separate runner initialization and
constructs a new function per run.

In this sample SES wall time was about 5.9 times faster than QuickJS wall time,
but about 5.6 times slower than the existing executor's command-collection
CPU time. These comparisons are local measurements, not guaranteed ratios.
Checkmate's bounded multi-step tactical search accounts for most SES worker
execution time in this workload. QuickJS reported 479,404 bytes of interpreter
heap across five runners after the browser sample, against a configured
combined 80 MiB cap. SES worker memory was not reliably measurable.

The exact user-provided rounded figures (110.5 ms / 3.55 s / 683 ms;
486 ms / 17.24 s / 3.00 s; 950 ms / 31.43 s / 5.33 s) are consistent with
this recorded run.

### Node QuickJS run

The latest recorded `npm run bench:quickjs` run measures only the existing
executor and QuickJS in Node. SES is a browser module-worker experiment and is
not part of this benchmark.

| Ticks | Existing executor | QuickJS reused runtime | QuickJS / existing |
|---:|---:|---:|---:|
| 100 | 96.56 ms | 4,094.33 ms | 42.40× |
| 500 | 339.39 ms | 12,601.57 ms | 37.13× |
| 1,000 | 779.29 ms | 31,847.45 ms | 40.87× |

QuickJS used 479,020–479,404 bytes of interpreter heap across the five
runtimes in these Node samples. The browser and Node figures differ and
should not be combined as if they were measured on the same runtime or
hardware. An older local benchmark had approximately 0.438 s for the
existing executor and 20.28 s for QuickJS over 1,000 ticks; it is historical,
not the latest run.

## 6. Security and tradeoff comparison

| Concern | Existing `new Function()` | QuickJS prototype | SES + Web Worker prototype |
|---|---|---|---|
| Browser/application API isolation | None; player code runs in the app realm. | Separate QuickJS context with no browser globals or application callbacks. Not a process boundary. | SES compartment in a separate worker; no ambient browser APIs or app endowments were supplied. Not an OS-process boundary. |
| Infinite loops | No limit; can block the application thread. | Interpreter interrupt/time budget; because the runner is synchronous, the caller thread may remain blocked until the interrupt. | Host timeout terminates the worker and runner can recover on a later tick; timeout delivery may be delayed if the host event loop is not scheduled. |
| Memory limits | None. | Explicit QuickJS heap and stack limits. They exclude some host/WASM overhead. | No per-worker heap limit. A worker can still exhaust browser-process memory. |
| Worker termination | Not applicable; production execution is on the caller thread. | Not implemented in this prototype. | Implemented and tested for timeouts; it does not prevent memory exhaustion. |
| TankScript compatibility | Reference behavior; current API. | Seven actions, state names, first-action behavior, early return, and all official tanks pass tests. | Same action/state API and valid commands for all five official tanks; random stream differs and dynamic `import()` is rejected. |
| Performance in recorded browser sample | Fastest, but unsafe for untrusted scripts and synchronous. | Slowest; roughly 31.5× the existing executor's CPU time at 1,000 sample ticks. | Roughly 5.9× faster than QuickJS wall time, but 5.6× slower than existing executor CPU time. |
| Implementation complexity | Small and synchronous. | WASM lifecycle, handles/disposal, interpreter limits; current runner is synchronous. | SES lockdown, module workers, JSON protocol, timeout/restart/error paths, and asynchronous tick coordination. |
| Potential server-side use | Not suitable for untrusted code. | QuickJS runs in Node, but still needs worker/process isolation and resource limits. | SES works in Node, but this browser worker runner is not a server design and SES itself has no memory quota. Use process-level resource controls. |

Neither experiment is completely secure by virtue of these tests passing.
The threat model, browser and interpreter versions, dependencies, memory
limits, isolation boundaries, and operational recovery all need review before
executing hostile community code in production.

## 7. What we learned

- The existing API is `createTankScriptApi()`, with seven actions and
  `allTanks`; the experiments preserve that API rather than introducing
  alternative action names or changing game rules.
- A QuickJS runtime can execute all five official scripts with heap, stack,
  and interrupt limits. Its synchronous execution still threatens UI
  responsiveness, and its measured overhead is substantial.
- SES's `Compartment` and `lockdown()` can keep application globals out of the
  player-code environment and prevent shared intrinsic prototype mutation.
  Running it in a worker adds an external timeout and tested recovery from a
  hung script.
- SES default randomness is tamed. The local PRNG enabled the official scripts
  without granting the compartment host APIs, but randomized commands need
  not match the other executors.
- SES blocks dynamic module imports without an import hook. This was explicitly
  tested and surfaced as an incompatibility.
- A test initially found that the SES runner did not accept the worker's
  successful `initialized` response. The protocol was corrected and the
  browser suite was rerun. The dynamic-import test also required handling
  SES's actual `SES_IMPORT_REJECTED` compilation failure instead of assuming
  import was merely unavailable at runtime.
- The latest recorded Firefly comparison differed between production and the
  two experimental executors; the other four official tanks matched in that
  controlled sample. Different random streams explain possible action
  differences; the run is not a deterministic cross-runtime conformance test.
- SES's workers have no enforceable memory quota in this prototype. A bounded
  32 MiB allocation test is not evidence that unbounded memory attacks are
  safe; unbounded allocation was intentionally not attempted.
- QuickJS has memory/stack caps but its direct runner executes on the calling
  thread. Worker-based QuickJS was discussed but not implemented or measured.
- Both experiments return commands; neither is integrated with battle
  lifecycle or tick resolution. Production engine logic and React components
  were intentionally left alone.
- Neither runner was merged into production because each has unresolved
  operational/security tradeoffs, and a production migration would require
  explicit async tick coordination, error policy, resource budget decisions,
  and broader browser testing.

### Separate dependency advisory

The dependency audit during this work reported advisories affecting
`dompurify@3.4.15`, pulled in transitively by `monaco-editor@0.57.0` through
`@monaco-editor/react`. The audit classified the chain as critical and listed
multiple DOMPurify advisories. This is separate from the sandbox experiments;
no dependency remediation was performed here. Review the current advisory
details and supported Monaco/DOMPurify upgrade path before deciding how to
address it.

## 8. Recommendations for future work

No option below is selected or integrated. Revisit the threat model first.

### QuickJS inside a Web Worker

This is a promising browser-side experiment if both a heap/stack cap and a
hard-stop mechanism are desired: QuickJS provides interpreter limits, and a
worker can be terminated externally. It may improve UI responsiveness
relative to the current direct QuickJS runner, but worker startup, messages,
JSON serialization, per-worker memory, and tick latency would add costs.
Benchmark this implementation against the SES worker using the same browser
and snapshots before selecting it. Decide whether one worker per tank or one
worker hosting multiple isolated QuickJS contexts gives the needed fault
isolation and memory budget.

### SES with additional resource protections

SES + workers showed better browser performance than QuickJS in the recorded
sample and passed the tested isolation cases. To be viable for untrusted code,
it needs a credible memory-exhaustion control beyond a timer. Possible controls
include a browser/process boundary or an externally supervised execution
service; a JavaScript timeout alone is not a heap quota. Assess SES/browser
support, supply-chain and update policy, compartment lifetime, and the cost of
preserving deterministic or desired randomness.

### Properly isolated server-side execution

For genuinely hostile, multi-user scripts, consider executing code in a
separate process or container with operating-system-enforced CPU, memory,
wall-clock, and process limits. Apply least privilege, restrict filesystem and
network access, supervise/terminate stuck jobs, and validate commands at the
trusted game boundary. A Node VM or SES compartment alone should not be
assumed equivalent to an OS isolation boundary. Measure the operational cost
and the latency of requesting commands remotely.

### Server-authoritative battles and WebSockets

If WebSockets are added later, server-authoritative battles can keep the
canonical state and command resolution on the server, reducing reliance on
client-reported outcomes and addressing competitive cheating more directly.
WebSockets are only a communication transport: they do **not** make executing
submitted JavaScript safe. The server still needs an isolated execution
environment, resource limits, command validation, authentication/authorization,
rate limits, and a clear failure policy. Do not execute user code inside an
unprotected Express request or the main server process.

### Questions to answer before choosing

1. Are tank scripts written by trusted local users, or arbitrary Internet
   users? What are the consequences of code reading browser data, making
   requests, freezing a client, or exhausting shared memory?
2. Must scripts run in the browser, or can command execution move to a
   separately supervised server process?
3. What per-tank CPU, wall-time, stack, heap, and total per-battle memory
   budgets are acceptable? What happens when one tank exceeds them?
4. Should a timeout forfeit that tick, skip the tank, restart its runtime, or
   end the battle? How many consecutive failures are tolerated?
5. Are `Math.random()` decisions part of the public compatibility contract?
   Is reproducible randomness or cross-client determinism required?
6. Must dynamic imports remain unsupported, and are there other JavaScript
   features the official/community scripts rely on?
7. What minimum browser versions, worker policies, CSP, and deployment
   constraints need support?
8. How should the engine await all simultaneous commands without allowing
   late responses from an old tick or terminated worker to affect later ticks?
9. What dependency update, security advisory, monitoring, and incident-response
   process will cover the sandbox runtime and browser engines?
10. Which adversarial tests and independent security reviews are required
    before the code can be called production-ready?

## 9. Resume the experiments

All commands below are run from the repository root.

### Files

- Production reference: [`tankScriptExecutor.js`](../tankScriptExecutor.js),
  [`tankScriptApi.js`](../tankScriptApi.js), and
  [`battleEngine.js`](../../engine/battleEngine.js).
- QuickJS implementation and tests:
  [`quickjsTankRunner.js`](../quickjsTankRunner.js),
  [`quickjsTankRunner.test.js`](../quickjsTankRunner.test.js), and
  [`quickjsTankRunner.md`](../quickjsTankRunner.md).
- QuickJS Node benchmark:
  [`benchmarkQuickJSTankRunner.js`](../../../../scripts/benchmarkQuickJSTankRunner.js).
- SES runner, worker, browser tests, and browser benchmark:
  [`sesTankRunner.js`](./ses/sesTankRunner.js),
  [`sesTankWorker.js`](./ses/sesTankWorker.js),
  [`browser-lab.js`](./ses/browser-lab.js),
  [`browser-lab.html`](./ses/browser-lab.html), and
  [`SES README`](./ses/README.md).

### Commands

```sh
# QuickJS security/API/compatibility tests (Node's built-in test runner)
npm run test:quickjs

# Existing executor versus QuickJS in Node (includes 100, 500, 1,000 ticks)
npm run bench:quickjs

# Start the browser lab server
npm run ses:lab -- --port 4173

# Then open:
# http://127.0.0.1:4173/src/game/tank-script/experimental/ses/browser-lab.html
# Click "Run browser tests and benchmarks".

# Production app build
npm run build
```

The SES security tests and benchmarks run in the browser lab; there is no
separate `test:ses` or `bench:ses` npm script. Dangerous scripts are executed
in worker contexts and terminated where appropriate. The browser lab prints
security-check pass/fail results, command comparisons for all five tanks,
worker startup and compilation timings, 100/500/1,000 tick measurements,
serialization/message estimates, and available heap measurements. SES worker
heap is not exposed by the browser. The Node benchmark prints command counts,
times, slowdown ratio, and QuickJS heap. Randomness means repeat runs can
produce different command counts and timing samples.

### Suggested next steps

1. Re-read the threat-model questions above and decide whether the goal is
   browser responsiveness, execution security, competitive integrity, or all
   three.
2. If staying client-side, implement a small QuickJS-in-worker experiment
   separately and compare it with SES in the same browser lab, using identical
   snapshots and explicit startup, message, execution, timeout, and memory
   measurements.
3. Investigate realistic memory containment for SES workers before considering
   untrusted user code; do not infer a heap cap from timeout or worker
   termination.
4. If server-authoritative battles are pursued, design the execution boundary
   and OS resource controls independently from the WebSocket protocol.
5. Only after a design is selected should a separate task propose changes to
   asynchronous BattleEngine command collection and define behavior for
   timeouts, worker restarts, invalid code, and repeated failures.

Do not use the untrusted-code tests as ordinary main-thread tests, do not
remove the prototype documentation while consolidating it, and do not treat
these experiments as production-ready.
