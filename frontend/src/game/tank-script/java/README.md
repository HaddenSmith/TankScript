# Experimental Java Debugger

Java is opt-in for the development Debugger only. Saving, battles, leaderboards
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
  and memory-abuse stress testing remain gates before public or battle use.
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
npm run build
node tests/browser/javaDebugger.mjs --production
node tests/browser/javaDebugger.mjs --disabled
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

Current results: **254 Jest tests**, **66 existing runner tests**, **2 Java gating
tests**, **99 loader tests**, and **18 development browser checks** passed.
Production and ordinary development availability checks passed. The production
build passed, including with `VITE_EXPERIMENTAL_JAVA=true`; no Java compiler/runtime
assets or executable Java worker were included. Existing dependency directive
and bundle-size warnings remain.

The next sensible milestone is development-only mixed-language runner parity and
resource testing, keeping BattleEngine unchanged. Do not enable normal battles
or persistence until those gates and broader browser checks pass.

Files in this milestone:

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

## Licenses

Retain the experiment's [NOTICE](../../../../../experiments/java-teavm/NOTICE.md)
and [license files](../../../../../experiments/java-teavm/licenses/). The local
asset route serves these alongside the compiler. TeaVM/browser compiler are
Apache 2.0; included OpenJDK compiler components use GPL v2 with the Classpath
Exception, with additional third-party notices. The existing loader patch's
attribution and modification notice remain intact. Complete the corresponding
source/notice distribution inventory before public binary distribution; the
Classpath Exception does not waive compiler redistribution obligations.
