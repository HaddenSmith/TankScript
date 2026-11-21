# Java development handoff

Updated November 20, 2026. **Java development is paused indefinitely.** TankScript's
public languages are JavaScript, TypeScript and Python. Java is preserved as a
development-only implementation, not an upcoming release. Do not enable it or
resume runtime development without a deliberate new decision.

This is the starting point for a future developer. Detailed reports below retain
their original findings; earlier proposed pilot milestones are historical options,
not the current work plan.

## Verified implementation

The opt-in development environment has working Java language selection/logo,
separate editor drafts, `starterJavaCode.js`, Monaco highlighting and a small
TankScript completion provider. Generate Command reports javac file/line/column
diagnostics, compiles genuine Java and runs it in the Debugger. Java also works
with JavaScript/TypeScript/Python in the existing Battle page, with retained
per-tank fields, cancellation and cleanup. Authenticated tank CRUD stores original
Java source with `language: "java"`; no compiled bytes or runtime objects are saved.

The current API is **`public class MyTank`** with
**`public void tick(TankScript.Snapshot state, TankScript api)`**. See
[TankScript.java](TankScript.java), [TankEntrypoint.java](TankEntrypoint.java) and
[starterJavaCode.js](../../../tank-editor/editor/starter-code/starterJavaCode.js).
All seven actions and first-action-wins use the shared command contract. The
earlier experiments' `String tick(...)` interface is not the integrated API.
Autocomplete is intentionally small; there is no full Java language server or
promise of complete Java/JVM library compatibility.

## Architecture and entry points

- `javaTankRunner.js`: compile/cache/start, `runTick(snapshot)`, `dispose()` and
  resource reservations. Shared runners route Java here behind the feature gate.
- `javaWorkerSession.js`: opaque-origin `sandbox="allow-scripts"` frame, private
  message ports, worker ownership, external deadlines and cancellation.
- `javaTankWorker.js`: trusted browser javac/TeaVM compiler worker and separate
  persistent WasmGC tank worker. One compiled artifact may back independent tank
  objects; ordinary ticks never compile.
- `javaRuntimeAssets.js` / `javaToolchain.json`: credential-free asset loading and
  SHA-256 verification. `scripts/javaDebuggerAssets.mjs` serves reviewed local
  assets only for opted-in Vite development.
- The shared snapshot/action adapters feed the **unchanged BattleEngine**. Java
  does not have a separate simulation or backend execution service.

TeaVM is pinned to **0.16.0**; browser-compiler source is
`cf274939233f390b4bc92413c2b057ab14c323d3`, with the recorded SDK fix. The embedded
javac comes from the pinned JDK 25 source, not a full Java 21 compatibility layer.
The patched loader replaces dynamic JS generation with fixed helpers. Source,
asset pins and patch details are in the [integration README](README.md) and
[TeaVM experiment](../../../../../experiments/java-teavm/README.md).

## Production gates: preserve all of them

Frontend Java requires `VITE_EXPERIMENTAL_JAVA=true` **and** an opted-in non-production
Vite development server. Production builds ignore the opt-in and use a rejecting
adapter stub; compiler/class-library and execution-worker assets are excluded.
Opening the selector loads only the Java logo/ordinary UI, not the Java runtime.
Local storage, query parameters and request payloads do not control this flag.

Backend Java requires **both** `NODE_ENV=development` and
`VITE_EXPERIMENTAL_JAVA=true`. Production rejects Java creation/conversion, hides
Java records from owned/community lists, and rejects updates/deletion of existing
Java records. Authentication and ownership still apply. Disabling Java preserves
the stored source; it does not migrate or delete records. See `backend/index.js`
and `tests/integration/javaTanks.test.js`.

Do not remove server-side gating or mistake the public selector's disabled label
for the security boundary. No production deployment/configuration change is needed
to keep Java dormant.

## Why work stopped

| Finding | Detailed evidence |
| --- | --- |
| Browser WasmGC has no practical application-configurable compiler-wide or per-tank heap quota. Linear limits do not cap ordinary Java objects/arrays. | [MEMORY-CONTAINMENT.md](MEMORY-CONTAINMENT.md) |
| Javac/TeaVM initialization and compilation have significant cost; retaining compiler pools was not justified by measured reuse. Browser memory reclamation is asynchronous. | [Memory report](MEMORY-CONTAINMENT.md), [RELIABILITY.md](RELIABILITY.md) |
| Repeated compiler builds produced different Wasm code hashes; reviewed loader/class libraries matched. Working pins were not replaced. | [PUBLIC-READINESS.md](PUBLIC-READINESS.md#rebuild-and-release-provenance) |
| Exact corresponding-source/notice packaging and combined GPL/Classpath/MPL distribution review remain incomplete. | [Readiness report](PUBLIC-READINESS.md#licensing-and-distribution), [NOTICE](../../../../../experiments/java-teavm/NOTICE.md) |
| Public asset delivery/staging and lower-memory/physical-mobile/retail-Safari coverage are incomplete. | [Readiness blockers](PUBLIC-READINESS.md#remaining-blockers-ranked) |

The historical [CheerpJ README](../../../../../experiments/java-cheerpj/README.md)
and [report](../../../../../experiments/java-cheerpj/REPORT.md) explain its JVM,
startup, isolation and licensing tradeoffs. The [TeaVM report](../../../../../experiments/java-teavm/REPORT.md)
explains why TeaVM was selected and how restrictive CSP became possible. Neither
prototype report supersedes the later integrated API or public-release NO-GO.

## Safeguards and their limits

Opaque origin, restrictive frame/worker CSP, no JS `unsafe-eval`, no automatic
imports, a runtime Wasm import allowlist and exact fixed interop helpers protect
application data. Guest networking and protected storage were blocked in tested
cases. Java calls retain **100 ms** budgets and a separate **500 ms** watchdog;
trusted worker startup has a bounded handshake. Hung ticks, constructors and static
initializers were externally terminated in browser checks.

Current application guards are four starting/running Java tanks per document and
per battle, one compiler, eight new compiler starts/minute, 100,000 source code
units, and three compiled cache entries / **8 MiB total**. Compiler startup/compile
deadlines are 30/120 seconds. These reduce abuse but do not prevent allocation
peaks/OOM, guarantee immediate RAM reclamation, or impose an origin-wide tab quota.
Do not reinterpret the runtime's 64 MiB **linear-buffer** maximum as a Java heap cap.

## Local use, if Java is deliberately revisited

Use two local terminals with the reviewed assets already present:

```powershell
# Frontend terminal
$env:VITE_EXPERIMENTAL_JAVA = 'true'
npm run dev

# Backend terminal
$env:NODE_ENV = 'development'
$env:VITE_EXPERIMENTAL_JAVA = 'true'
npm run dev:backend
```

Java then appears as experimental. Changing environment variables requires server
restarts. Never set production servers to development just to expose Java.
For missing ignored assets, follow the [experiment setup](../../../../../experiments/java-teavm/README.md).
A local developer JDK builds the trusted compiler; player tanks compile in the
browser. Keep existing checksums unless a new build's provenance is reviewed.

## Existing verification tools

Run from the repository root; browser suites run serially:

```powershell
npm test -- --runInBand
npm run test:runner
npm run test:integration
node --test tests/unit/tanks/javaGating.test.mjs experiments/java-teavm/csp-runtime.test.mjs
node tests/browser/javaDebugger.mjs
node tests/browser/javaBattle.mjs --functional-only
node tests/browser/javaEditor.mjs --security
npm run build
node tests/browser/javaDebugger.mjs --production
node tests/browser/javaBattle.mjs --production
git diff --check
```

The editor/integration suites use real Express/MongoDB with uniquely named temporary
databases and require the private local DB configuration. Editor checks optionally
support Firefox/WebKit through the ignored tools documented in the readiness report.
Chromium/Firefox/WebKit desktop engine results are not physical-mobile certification.
`javaReliability.mjs`, `javaResources.mjs` and the experiment's `memory-containment.mjs`
are retained diagnostic labs, not required steps for routine public-language changes.
Do not repeat large allocation probes without a specific new hypothesis and safe
host-memory headroom. Historical counts/measurements live in the linked reports.

## Priorities if work resumes

1. Reaffirm the product/threat model before changing code. Strong containment of
   hostile community Java is unavailable in the current browser design; an
   explicitly limited own/curated-code pilot would accept local availability risk.
2. If strong quotas are required, evaluate an externally supervised process/runtime
   architecture with enforceable resource limits as a separate project. TeaVM's
   old non-GC Wasm backend was removed; instrumentation/C pipelines are substantial
   unproven alternatives, not small loader settings.
3. Complete the source/license distribution package and compiler provenance work.
   Avoid automatically replacing pinned assets or using unstable releases.
4. Define reviewed versioned production assets, browser capability checks, device
   coverage and staging security/cleanup tests before considering public gates.
5. Re-run the editor, persistence, mixed-language and security regressions; review
   any public enablement as its own deliberate release decision.

There is no scheduled next Java implementation milestone. Preserve the code and
evidence while gameplay work continues.
