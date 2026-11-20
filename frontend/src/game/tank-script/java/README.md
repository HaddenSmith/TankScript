# Experimental Java integration

Java is opt-in for the development Debugger and Battle page. Saving, leaderboards
and backend validation do not support Java. Production builds keep it disabled,
even when the environment variable below is set.

## Local setup

From the repository root, with the reviewed TeaVM experiment assets present:

```powershell
$env:VITE_EXPERIMENTAL_JAVA = 'true'
npm run dev
```

Select **Java — experimental** in the Tank Editor and open **Debugger**. Generate
Command compiles the starter and runs one tick. The status shows loading,
compilation and initialization; Cancel Java stops pending work. Each language
keeps its own draft. Java drafts cannot be saved.

For a battle, put the same `MyTank` source in a `.java` file. In Battle Setup,
use **Load Java tank (.java)** under **Experimental Java Tanks**, then add it
with the normal quantity buttons alongside community or official tanks. Files
are limited to 100 KB, stay in that page's React state, and are never uploaded
or stored. Navigating away removes the loaded options. Public builds have no
file loader and reject Java at the shared runner and adapter boundaries.

## Mixed-language battles

`mixedTankScriptRunner.js` now handles both Python and Java as separate isolated
runners. JavaScript/TypeScript still share the existing QuickJS battle worker.
There is no Java-specific simulation: the Battle page obtains the existing
BattleEngine snapshots, waits for the complete command batch, and calls the
unchanged `resolveTick()` once. Replies preserve caller order. Each Java tank
has its own object and worker; identical source shares compiled bytes, not fields.

Startup creates one compiler/interpreter at a time to avoid concurrent compiler
heaps. Existing verified asset bytes and the bounded source cache are reused.
Ordinary ticks never compile or reconstruct Java objects. Timings distinguish
compiler initialization, compilation, runtime initialization and cache hits;
compilation time is zero for a cache hit. Twelve different programs can exceed
the three-entry cache and need recompiling on a later battle restart.

A Java source/constructor/static-initializer failure becomes an error for that
participant, so healthy tanks can start. A Java runtime failure or timeout closes
that worker and disables it until restart; its earlier submitted action is
discarded. Infrastructure failures and cancellation can still stop startup.
Python's existing initialization behavior is preserved. Pause/resume retains the
same runner and pending batch; reset, navigation and battle completion close the
workers through existing abort/dispose paths. The feature flag retains its
original internal name, `JAVA_DEBUGGER_ENABLED`, and controls both development
entry points.

The Vite plugin serves four existing files from
`experiments/java-teavm/generated/assets/` at `/__java-debugger__/`. It checks the
SHA-256 pins in `javaToolchain.json`; the browser checks them again before use.
No compiler binary is copied into `public/`, committed, downloaded automatically
or included in the production build. The production Java adapter is only a small
rejecting stub.

For a checkout missing the assets, follow the
[experiment setup](../../../../../experiments/java-teavm/README.md). It builds the
trusted browser compiler locally; player source still compiles in the browser.
Prepare its CSP loader with `node experiments/java-teavm/prepare-csp-runtime.mjs`.
A new build can have different fingerprints: review its provenance and outputs
before deliberately changing the adapter pins. Do not bypass the checksum check.

## Execution and API

- `javaTankRunner.js` implements the existing `runTick(snapshot)` / `dispose()`
  interface. `javaRuntimeAssets.js` preloads verified bytes without credentials.
- `javaWorkerSession.js` owns an opaque `sandbox="allow-scripts"` iframe, private
  message channel and Blob worker. `javaTankWorker.js` runs the existing patched
  TeaVM 0.16.0 loader and pinned browser compiler, not another Java runtime.
- Compilation uses javac → class files → TeaVM → Wasm GC. A temporary compiler
  worker is terminated afterwards. An in-memory cache holds at most three
  successful source revisions, each at most 8 MiB, for the current toolchain/SDK.
- A separate runtime worker constructs one `MyTank` and retains its fields across
  Generate Command calls. Code/language changes, leaving the Debugger, errors,
  cancellation and unmounting release it. Scenario edits supply a fresh snapshot;
  an idle Java object's fields remain intact.
- `TankScript.java` exposes all current snapshot fields as immutable records and
  lists. Numeric fields use `double` to preserve the shared numeric contract,
  including fractional bullet coordinates. `TankEntrypoint.java` is the trusted
  primitive/string boundary; names are data, never interpolated into Java source.
- Use `public class MyTank` and
  `public void tick(TankScript.Snapshot state, TankScript api)`. Read
  `state.tankPosition().x()` or `state.allTanks().get(0).health()`, for example.
  Call the seven existing actions through `api`: `moveUp()`, `moveDown()`,
  `moveLeft()`, `moveRight()`, `rotateLeft()`, `rotateRight()`, `shoot()`.
  The existing host action collector enforces first-action-wins. Returning from
  `tick()` without an action is valid; a thrown exception discards any action.

Monaco provides Java highlighting. Compilation diagnostics, including javac
file/line/column information when supplied, appear in Command output. Java API
autocomplete, inline compiler markers and a Java language server are not added.

## Isolation and limits

The frame and its worker inherit:

```http
default-src 'none';
script-src 'nonce-<random>' blob: 'wasm-unsafe-eval';
worker-src blob:;
connect-src 'none';
object-src 'none'; base-uri 'none'; form-action 'none';
```

There is no JavaScript `unsafe-eval`, same-origin permission, cookie/API proxy or
guest asset loader. All runtime Wasm imports are checked by module/name/kind;
automatic imports are disabled and unused host imports are removed. The only
permitted generated function bodies are an exact string identity helper and the
exact action callback, implemented as static host functions, never evaluated.
Restricting Java imports is not the security boundary. Application headers,
QuickJS and Python policies are unchanged.

External deadlines cover compiler startup/assets (30 seconds), compilation
(120 seconds), runtime loading (500 ms), and construction/ticks (100 ms, the
existing shared execution limit). Abort works even while assets are pending.
The frame explicitly terminates its worker and acknowledges cleanup; a 250 ms
fallback removes the frame if no acknowledgement arrives. A failed runtime must
be recreated; the next preview can reuse its compiled module.

Remaining limits:

- Wasm GC has no demonstrated hard per-tank heap quota. The 64 MiB linear-memory
  ceiling does **not** cap Java objects or compiler/browser memory. Compilation
  and memory-abuse stress testing remain gates before public use.
- TeaVM is not a complete JVM. This uses the experiment's pinned OpenJDK compiler
  build, not a promise of full Java 21/25 API compatibility. The restrictive host
  import list deliberately rejects unsupported capabilities. In testing,
  `System.nanoTime()` requested unsupported `teavmJso.callMethod0`; it remains
  blocked. Some exception messages and library diagnostics are incomplete.
- Source/dependency versions are pinned, but byte-identical compiler rebuilds
  remain unresolved. Archive a reviewed asset set and corresponding sources
  before distribution. No compiler rebuild was needed for this integration.
- Verified in Chrome 157 on Windows 11 (Core Ultra 7 155H, about 16 GiB RAM).
  Wasm GC/string-builtins support and CSP behavior in other browsers and
  slower laptops remain unverified. Background-tab throttling can affect wall
  clock deadlines. This local validation is not a security certification.

## Verification and next step

```powershell
npm test -- --runInBand
npm run test:runner
node --test tests/unit/tanks/javaGating.test.mjs experiments/java-teavm/csp-runtime.test.mjs
node tests/browser/javaDebugger.mjs
node tests/browser/javaBattle.mjs
npm run build
node tests/browser/javaDebugger.mjs --production
node tests/browser/javaDebugger.mjs --disabled
node tests/browser/javaBattle.mjs --production
node tests/browser/javaBattle.mjs --disabled
git diff --check
```

The browser test uses dummy local authentication/data and a disposable Chrome
profile. It exercises the actual Monaco Editor/Debugger, the full API, retained
fields, no-action/first-action behavior, source errors, cancel/edit cleanup,
runtime failures, infinite ticks, hung constructors/static initialization,
blocked interop, CSP/network/storage probes, and the three existing languages.
It also checks that an independent Java runner stays responsive after failures.
Security probes use CDP with its CSP bypass explicitly disabled. Results are in
`experiments/java-teavm/results/debugger-*.json`.

Debugger milestone results: **254 Jest tests**, **66 existing runner tests**, **2 Java gating
tests**, **99 loader tests**, and **18 development browser checks** passed.
Production and ordinary development availability checks passed. The production
build passed, including with `VITE_EXPERIMENTAL_JAVA=true`; no Java compiler/runtime
assets or executable Java worker were included. Existing dependency directive
and bundle-size warnings remain.

The Battle browser test uses genuine TeaVM, QuickJS and Pyodide and the unchanged
BattleEngine. It checks Java/Java and every mixed pairing, all four languages,
simultaneous movement, retained fields, compile/runtime failures, hung ticks and
initializers, the real page's file loader and pause/resume/reset/completion, and
repeated full battles. It records fresh-profile and warm-cache measurements for
1/4/12 identical Java programs plus 5,000 synthetic command batches per count
(10,000 for the 12-tank run).
Those synthetic batches test runtime reuse beyond a match's stalemate limit;
they do not extend the game's rules. Raw results: `results/battle-*.json` in the
TeaVM experiment directory.

Memory readings include Chrome's whole disposable profile and CDP worker heap
figures, not a hard Java heap quota. Fresh-profile runs leave OS/Vite caches
intact; warm runs reuse verified assets and compiled code in the same page but
construct new independent workers/objects. Compilation dominates cold startup.

Latest measurement, Chrome **157.0.8103.79**, Windows 11, Core Ultra 7 155H,
about 16 GiB RAM; one sample per count, November 19, 2026. Times are wall clock:

| Java tanks | Fresh profile: compiler init / compile | Time to first tick, cold / cached | Cached batch median / p95 | Chrome private MiB after 5,000 batches / final diagnostic GC |
| --- | --- | --- | --- | --- |
| 1 | 0.68 s / 8.84 s | 9.67 s / 78 ms | 0.6 / 1.3 ms | 661 / 644 |
| 4 | 0.66 s / 8.50 s | 9.50 s / 267 ms | 1.5 / 4.5 ms | 835 / 748 |
| 12 | 0.68 s / 8.44 s | 9.88 s / 633 ms | 2.0 / 4.3 ms | 891 / 590 |

New runtime/object initialization ranged from 45 to 81 ms in the cached samples
(75 / 59 / 51 ms median per object for 1 / 4 / 12 tanks). The table reports batch
latency, not twelve times a single tank's CPU duration.

For twelve tanks, private memory reached **1,124 MiB** after 10,000 batches,
then 590 MiB after diagnostic GC and 532 MiB after disposal; its initial whole
browser baseline was 430 MiB. The live worker heap readings after GC were about
0.43 MB each, but those readings are not a complete per-Java heap accounting.
Memory retention and transient growth remain significant. Forced GC was used
only to observe reclamation, never as a production memory-control mechanism.
Samples were taken between phases; the compiler's peak memory was not measured
and may be higher than these readings.
The final 5,000/10,000-batch runs had no deadline misses; one earlier repeat did,
as described below. These are samples, not guaranteed latency or memory bounds.

Ten actual four-language matches each completed after 125 no-damage ticks,
with zero workers remaining afterwards. Whole-profile private memory changed
from 666 to 618 MiB across those restarts; this does not prove leak freedom.
No lower Java-specific tank cap was added: the largest transient cost includes
compiler/browser allocations shared across tank counts, and the tested 12-tank
case completed. Keep development rosters small on memory-constrained machines;
the existing twelve-total-tank maximum and sequential startup remain in place.

One repeated saturated four-tank run hit the unchanged 100 ms wall-clock deadline
for two simple rotating tanks. Their workers were terminated and peers still
responded. The original failing probe is retained as
`results/battle-stress-deadline.json`; it is a reliability limitation, not a
passing zero-error soak. Scheduling/GC stalls are possible explanations, not a
verified cause. The resource probe now records contained deadline misses while
still requiring every tank to succeed during ordinary startup/latency checks.
It never retries or raises the budget to hide a failure. Battle execution keeps
the existing 12-participant maximum and sequential startup; neither is a hard
memory limit. Resolve benign deadline misses before claiming public readiness.

Before public Java: test adversarial allocation/compiler inputs, slower laptops
and other browsers; finish the binary/source license inventory and reproducible
asset release process; and separately design persistence/validation. Development
mixed battles do not establish a hard resource boundary or public readiness.

Battle milestone validation: **263 Jest tests (24 suites)**, **66 existing runner
tests**, **99 loader tests**, and **2 runner gating tests** passed. Chromium
passed **17 Battle checks** and both development-off/production Battle gates;
the production build succeeded with the flag set. The original Debugger checks
also passed **18 checks** and both gating scripts for isolation/regression coverage. Java
compiler/runtime assets remain absent from the production output. No backend,
BattleEngine or dependency changes were required.

Files in the Debugger milestone:

- Added this `java/` directory (runner, worker/session, asset loader/pins, Java
  API and entrypoint), shared `tankScriptFeatures.js`, `starterJavaCode.js`, and
  `scripts/javaDebuggerAssets.mjs`.
- Updated `vite.config.js`, shared `tankLanguages.js` / `tankScriptWorkerRunner.js`,
  `tank-editor.jsx` / CSS, `TankCodeEditor.jsx`, `TankConfiguration.jsx`,
  `TankScriptReference.jsx`, and `TankScriptDebugger.jsx`.
- Added `tests/unit/frontend/javaDebugger.test.jsx`,
  `tests/unit/tanks/javaTankRunner.test.js` / `javaGating.test.mjs`,
  `tests/browser/javaDebugger.mjs`, and three `debugger-*.json` browser reports;
  updated `tests/helpers/languageSelector.js`. Existing experiments, BattleEngine,
  backend, JavaScript/TypeScript/Python implementations and dependency files are
  unchanged.

Battle milestone changes: `battle.jsx` (local files and startup status),
`mixedTankScriptRunner.js` / `tankScriptWorkerRunner.js` (routing and contained
Java failures), `javaTankRunner.js` (cache/runtime timings and worker failure
normalization), Editor help/save messages, and README/test documentation. Added
`tests/browser/javaBattle.mjs` and `tests/unit/frontend/javaBattle.test.jsx`, and
extended mixed-runner, Java cache and gating tests. The Debugger browser test's
Monaco module variable now works in the gated test branch. BattleEngine,
Java/Python/QuickJS workers, CSP/loader assets, backend and dependencies are unchanged.

## Licenses

Retain the experiment's [NOTICE](../../../../../experiments/java-teavm/NOTICE.md)
and [license files](../../../../../experiments/java-teavm/licenses/). The local
asset route serves these alongside the compiler. TeaVM/browser compiler are
Apache 2.0; included OpenJDK compiler components use GPL v2 with the Classpath
Exception, with additional third-party notices. The existing loader patch's
attribution and modification notice remain intact. Complete the corresponding
source/notice distribution inventory before public binary distribution; the
Classpath Exception does not waive compiler redistribution obligations.
