# TeaVM browser Java experiment

Local evaluation only; nothing here enables public Java. The original standalone
prototype does not import TankScript's editor, BattleEngine, backend or language
runners. The later memory lab reuses its existing worker/frame helpers to inspect
the current integration. The CheerpJ experiment is preserved. See
[REPORT.md](REPORT.md) for the original measurements and recommendation.

The later TankScript [public-release review](../../frontend/src/game/tank-script/java/PUBLIC-READINESS.md)
records resource-abuse probes, three-engine tests, two compiler rebuilds and the
remaining source/license distribution requirements. It recommends keeping Java
development-only; the working compiler assets and hashes remain unchanged.
The focused [memory decision](../../frontend/src/game/tank-script/java/MEMORY-CONTAINMENT.md)
records compiler reuse and bounded 8/16/32 MiB array tests under smaller linear
limits. Run `node experiments/java-teavm/memory-containment.mjs` separately; it
uses a disposable profile and conservative local stopping thresholds. No compiler
rebuild or application change is needed.

## Run

Tested on Windows with Node 24, Chrome 157, PowerShell 7, and JDK 25. A developer
JDK builds the **trusted browser compiler**, never player tanks. All player Java
compilation happens inside Chrome; the local server only serves static files and
dummy security endpoints. No npm installation is needed.

With the existing experiment assets, prepare only the small JavaScript loader
variant. **No Java/Wasm compiler rebuild is needed**:

```powershell
node experiments/java-teavm/prepare-csp-runtime.mjs --inventory
node experiments/java-teavm/server.mjs
```

For a fresh checkout without generated assets, first run `./experiments/java-teavm/setup.ps1`.
Use `setup.ps1 -JdkPath 'C:/path/to/jdk-25'` for another JDK installation. Open
the URL printed by the server, then **Compile Java**, **Run tick** twice, and
**Stop workers**. The starter returns `shoot`, then `moveRight`. Editing source
and compiling again creates a fresh tank object; ordinary ticks never compile.

Automated checks, using a disposable Chrome profile:

```powershell
node experiments/java-teavm/verify-assets.mjs
node --test experiments/java-teavm/csp-runtime.test.mjs
node experiments/java-teavm/verify-csp.mjs
node experiments/java-teavm/smoke.mjs
node experiments/java-teavm/verify.mjs
node experiments/java-teavm/verify-extra.mjs
```

Set `TANKSCRIPT_EXPERIMENT_CHROME` to another Chrome executable if necessary.
The scripts reuse CheerpJ's dependency-free CDP helper and exact starter/attack
fixtures without editing them. `verify.mjs` measures independent compilation
and cached-code execution for 1/4/12 tanks. `verify-extra.mjs` checks the actual
controls, a second interop attack, healthy peers during guest hangs, separate instance state, and Windows browser
process memory. Current results use `results/csp-*.json`; earlier feasibility
measurements are preserved. Browser/hardware details and caveats
are recorded with the results. Other operating systems/browsers are unverified.

## Pinned toolchain

- Official `teavm-javac` source: `cf274939233f390b4bc92413c2b057ab14c323d3`.
- TeaVM compiler and Wasm GC runtime: **0.16.0**, a stable release.
- OpenJDK compiler source: `jdk25u` revision
  `6c48f4ed707bf0b15f9b6098de30db8aae6fa40f`.
- Official SDK metadata fix: `76b5b53850f74e510ec8588a56a211cf60e9d496`,
  adapted to the older build's `ArchiveBuilder` package.
- Gradle 9.1.0; checked source/archive/distribution hashes. No rolling playground
  binary or `latest` URL is used.

The setup also supplies a missing upstream Checkstyle version, builds within one
developer JVM to avoid a failed upstream RMI helper, and normalizes
Windows separators/order in generated class-library archives. These are
experiment build corrections. It does not patch production code or implement
a Java parser/interpreter.

The large source/Gradle cache lives under the system temporary directory in
`tankscript-teavm-<revision>`. Only ignored static assets and their generated
manifest go under `generated/`. A first build needs substantial downloads and
took several minutes; those are developer setup costs, excluded from browser
timings. `asset-lock.json` pins source versions and records reference asset
fingerprints. `generated/asset-manifest.json` records the actual build, checked
again by the browser. Byte-identical compiler output across builds was **not**
established; preserve a reviewed build before distributing it.

## Execution and isolation

One compiler worker runs OpenJDK javac → class files → TeaVM → Wasm GC. Separate
runtime workers instantiate the generated module and keep one `MyTank` object
each. The snapshot remains `(tankId, x, y, health)` and the Java method returns
the same command strings as CheerpJ. A trusted primitive-number boundary maps
those commands without granting arbitrary JavaScript interop.

Compiler and tank workers are created by a hidden `sandbox="allow-scripts"`
iframe on a separate loopback host. Their origin is opaque. The parent preloads
all assets; frame/worker CSP uses `connect-src 'none'`. Module imports are checked
against an explicit capability list, automatic module loading is disabled, and
arbitrary `@JSBody` helper text is rejected. The sole permitted string helper is
implemented as a fixed identity function. An external supervisor terminates
overdue workers, including hung constructors/static initialization.

The default loader now works **without JavaScript `unsafe-eval`**. The original
stock loader is kept only as a failing negative control. `prepare-csp-runtime.mjs`
verifies its pinned hash and replaces ten `new Function` sites with static
closures from `csp-runtime-support.js`. Seven exact compiler helper definitions
are implemented directly; arbitrary bodies are rejected, never interpreted.
The original TeaVM loader, Java compiler, Wasm modules, exception support and
initialization API remain in use. This is a local, version-specific patch, not
an upstream TeaVM CSP option.

The isolated frame/worker's minimum working policy is:

```http
default-src 'none';
script-src 'nonce-<random-per-response>' blob: 'wasm-unsafe-eval';
worker-src blob:;
connect-src 'none';
object-src 'none'; base-uri 'none'; form-action 'none'
```

The nonce permits only the trusted frame script; `blob:` permits the trusted
preloaded worker/loader code. Player source is passed as data, never inserted
into a JavaScript blob. `wasm-unsafe-eval` permits Wasm compilation while browser
tests verify that `eval`, `Function`, async-function and generator-function
constructors still fail. Removing that narrow Wasm permission blocks startup;
there is no broader fallback or query parameter that enables JavaScript eval.

Existing TankScript and Python policies are unchanged. The CSP milestone permits
a staged, restricted Java integration next; public release still needs the full
snapshot/API adapter, broader browser checks and resource-abuse testing.
Wasm GC heap usage also has no hard per-tank quota here; the 64 MiB linear-memory
ceiling is not a Java heap limit.

Only dummy local cookies, storage, and private endpoints are used. Never point
the probes at real account data or publish this evaluation as a production
execution service. License texts and source references are in [NOTICE.md](NOTICE.md)
and `licenses/`.
