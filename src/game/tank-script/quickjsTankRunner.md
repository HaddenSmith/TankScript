# QuickJS TankScript prototype

This is an isolated experiment. The production `BattleEngine` and
`executeTankScript()` still use the existing synchronous execution path.

## What it executes

The current repository API is seven action functions:
`moveUp()`, `moveDown()`, `moveLeft()`, `moveRight()`, `rotateLeft()`,
`rotateRight()`, and `shoot()`. The first called action is kept for the tick.
There is no current `createTickCommandApi()`, `move()`, `moveBackward()`, or
`tankPositions`; the matching production code is `createTankScriptApi()` and
the public arena snapshot is named `allTanks`.

The sandbox also provides the state used by existing scripts:
`tankId`, `tankPosition`, `tankRotation`, `tankHealth`, `allTanks`,
`allBullets`, `arenaWidth`, and `arenaHeight`. The state is copied into QuickJS
as JSON and recursively frozen before player code runs. Each call receives a
new snapshot.

```js
import { createQuickJSTankRunner } from './quickjsTankRunner.js';

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

Initialization is asynchronous because QuickJS loads its WebAssembly module.
`runTick()` is synchronous; it returns `{ action }` or `undefined`, and throws a
typed `TankScriptExecutionError` for compilation, timeout, memory, or runtime
failures. Create one runner per tank/code, reuse it through the battle, and
dispose it when that battle ends. Each runner has its own QuickJS runtime,
context, heap, and compiled function. Code is compiled once per runner.

## Isolation and limits

The VM receives no application objects, host callbacks, or module loader. Its
own QuickJS standard library is not the browser global: `fetch`, `window`,
`document`, storage, `process`, and similar host objects are absent. Date,
regular expressions, proxies, promises, and typed arrays are also disabled;
the built-in tank scripts work with this reduced set. Runtime heap and stack
limits are enforced by QuickJS, and an interrupt handler imposes a per-run
wall-clock budget.

These are defense-in-depth controls, not proof that arbitrary hostile code is
safe. A runtime interruption happens on the calling thread, so the browser UI
can still be unresponsive until QuickJS reaches an interrupt check. A QuickJS
or WebAssembly implementation bug would also remain relevant. Each runtime
limits its QuickJS heap, but the limit does not include the shared WebAssembly
module, host-side state serialization, or JavaScript wrapper objects. The
default limit also means five simultaneous player runtimes can each consume up
to 16 MiB of QuickJS heap.

The existing executor makes a new function on each tick, so function-local
variables do not persist. Explicit globals can persist in its browser global.
This prototype likewise creates a fresh function scope for every tick, while
any deliberate writes to `globalThis` persist only in that tank's private
QuickJS runtime. The five official tanks do not depend on retained globals;
they recompute their choices from the supplied snapshots.

## Battle behavior and compatibility

The production engine currently executes each living tank synchronously in
`#collectCommands()`, collecting one action per tank before it resolves
simultaneous movement and executes the commands. This prototype only returns
the command; it does not change or reproduce engine resolution. Focused tests
run all five official scripts, including the shared `tacticalCode.js` source
used by the hard, expert, and overkill tanks.

Run the prototype tests with `npm run test:quickjs`. Run the repeated-tick
comparison with `npm run bench:quickjs`. The benchmark runs the five official
tank programs against the same 100, 500, and 1,000 changing arena snapshots
for both the current `new Function()` executor and reusable QuickJS runners.
It captures snapshots from actual `BattleEngine` runs, restarting a battle when
it ends to reach the requested sample length. Timed sections measure command
collection only, not the simulation/resolution phases or rendering.

## Worker assessment

A Web Worker would keep QuickJS execution off the UI thread, and the host can
reliably stop a stuck worker with `terminate()`. That hard-stop guarantee is
stronger than the in-runtime interrupt alone. The tradeoff is asynchronous
command collection: preserving simultaneous resolution means the engine must
wait for every living tank's response before resolving a tick. A single worker
could host several isolated QuickJS runtimes; separate workers per tank make
individual termination easier but add startup and memory costs. This prototype
does not add a worker or change engine timing.

Integrating it would require preparing and disposing runners with battle/tank
lifecycle, replacing `#collectCommands()` with an asynchronous command
collection boundary (or a worker coordinator), handling per-tank errors and
timeouts explicitly, and keeping the existing command-resolution phases
unchanged. The five official scripts are compatible in the direct prototype,
but performance and browser responsiveness should be measured in the actual
battle UI before considering that integration.
