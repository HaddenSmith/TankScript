# TeaVM Java feasibility and restrictive CSP results

Updated November 19, 2026. **The CSP gate now passes: both browser compilation
and Java execution work without JavaScript `unsafe-eval`. TeaVM is ready for a
restricted, staged integration milestone, not general public untrusted-code
release.** Production files, existing language isolation, and Java's disabled
editor state are unchanged. No Java/Wasm compiler rebuild was performed for
this milestone.

## What worked

- Genuine OpenJDK javac and TeaVM ran as WebAssembly in a browser worker. The
  server has no compilation endpoint. TeaVM generated a new Wasm GC module from
  the player's source, then a separate worker instantiated it.
- The unchanged CheerpJ starter exercised a class, field, variables, loop,
  conditionals, helper method and snapshot record. Its retained object returned
  `shoot`, then `moveRight`; every benchmark actor ran 51 ticks after one compile.
- `ArrayList<Integer>`, `HashMap<String,Integer>`, `HashSet<Integer>`, generics,
  enhanced loops and `var` worked. Invalid Java reported file, line and column.
- The Java-facing contract remains `String tick(Snapshot state)`. A trusted
  adapter converts command strings to integers at the Wasm boundary and back to
  the same host actions. This avoids broad string/object interop capabilities.
- Multiple independent instances of one compiled module retained separate state.
  The actual Compile / Tick / Stop controls passed browser checks.

The checked setup pins official browser-compiler source, TeaVM **0.16.0**, the
OpenJDK source revision and SDK fix; see [README.md](README.md). The embedded
javac is built from **JDK 25**. Tested syntax includes features also available
in Java 21; this is **not a Java 21 compatibility certification** or a complete
Java 25 library. The pinned compiler API does not expose `--release 21`.

## Original performance measurements and CheerpJ comparison

Same laptop and Chrome version as CheerpJ: Intel Core Ultra 7 155H, 22 logical
processors, 15.51 GiB RAM, Windows 11 Home, headless Chrome 157.0.8103.79. No
CPU/network throttling; CDP instrumentation; managed extensions present despite
the disable-extensions flag. One trial per group per build, not repeated startup statistics.
The exact same starter and four-field snapshot were used. The comparison table
uses the initial run preserved in `results/measurements-initial.json`.

The first group used a **fresh Chrome profile**. Later groups used its warm HTTP
cache, but created new compiler/runtime instances. Each independent tank compiled
the source separately in parallel, matching CheerpJ's per-tank compilation work.
TeaVM has two workers per tank here (compiler + runtime); CheerpJ retains its
compiler inside one JVM worker. Both heap columns include retained compilers.

| Tanks | CheerpJ until first tick | TeaVM until first tick | CheerpJ group compile | TeaVM group compile | CheerpJ worker heaps | TeaVM worker heaps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | ~46 s | 11.7 s | 22.4 s | 10.6 s | 63 MiB | 72 MiB |
| 4 | ~43 s | 13.8 s | 27.0 s | 12.2 s | 255 MiB | 262 MiB |
| 12 | ~107 s | 34.4 s | 69.0 s | 31.1 s | 670 MiB | 744 MiB |

TeaVM compiler-ready group times were 0.86 / 1.30 / 2.57 s. One fresh compiler
spent 0.40 s in javac and 10.13 s in TeaVM optimization/code generation. Reusing
one compiler reduced a subsequent build to **9.03 s**, including 0.07 s javac;
warm compiler reuse alone does not eliminate compilation costs.

Steady per-tank tick median / p95 for CheerpJ was 0.6/2.0, 1.0/5.1 and
1.4/14.1 ms. TeaVM's median was below the 0.1 ms timer resolution, p95 0.1 ms
for all groups; maximum 0.1 / 0.6 / 2.4 ms. Complete batch round-trip median /
p95 was 0.5/1.1, 0.8/1.9 and 3.2/6.3 ms. There were 50 / 200 / 600 steady
samples. These are tiny strategies, not realistic complex-AI benchmarks.

### Reusing compiled code

An additional measured mode used an already compiled, identical starter module,
disposed the compiler, and created separate runtime workers/Java objects:

| Tanks | Cached module → first tick | Runtime worker heaps combined |
| --- | ---: | ---: |
| 1 | 197 ms | 0.88 MiB |
| 4 | 258 ms | 3.51 MiB |
| 12 | 840 ms | 10.52 MiB |

This is a **cache hit in the same page with assets already loaded**, not fresh
compilation of twelve different players' tanks. Persistent caching across page
reloads is not implemented. Distinct source versions still need compilation. One source/version/API
cache and a bounded compiler queue or small pool are plausible future options;
those production cache policies are not implemented here. Objects and module
instances must remain separate even when compiled bytes are reused.

### Download, memory and measurement limits

Four self-hosted toolchain files total **7,202,580 bytes (6.87 MiB)**. A cold
loopback fetch plus hashing took 107 ms; a new page with warm HTTP cache took
152 ms and all four responses were disk-cache hits. These are local measurements,
**not Internet download estimates**. CheerpJ used its remote CDN and recorded
17.7 / 28.8 / 49.6 MiB across startup, compilation and ticks. Network conditions
were not controlled, so download/startup comparisons are not a WAN speed test.
The first TeaVM total above includes its 107 ms preload. The generated starter
module was about 28 KiB.

Heap figures use the same CDP `Runtime.getHeapUsage().usedSize` method as CheerpJ,
without forced GC. They exclude complete browser/process costs and are not hard
quotas. A separate cached-runtime follow-up measured the whole test browser:
**554 / 569 / 624 MiB private committed memory** for 1/4/12 tanks; summed working
sets were 952 / 961 / 988 MiB and may double-count shared pages. These include
managed extensions, main page and browser overhead after earlier compilation;
no comparable whole-browser CheerpJ measurement exists.

The worst page-heartbeat delay across the heavily instrumented run was 464 ms.
During the deliberate 500 ms guest hangs, the page still advanced 10–11 heartbeat
updates and a healthy tank replied. Follow-up checks waited 100 ms after starting
each hang, then received healthy replies in 103–112 ms, before termination.
Do not interpret worker isolation as a
guarantee of a perfectly smooth page under twelve simultaneous compilers.
Lower-end laptops, Firefox, Safari, battery use and thermal effects are untested.

## Security findings

### CSP loader investigation and change

The stock TeaVM 0.16.0 JSO runtime has **ten direct `new Function` expressions**:
global reads/writes (2), exported functions/named constructors/instance methods
(3), arity-specific call/method/construct/array helpers (4), and the JSBody
factory (1, which also constructs another function from its body string).
The arity loop eagerly creates 160 functions before `installImports` runs,
even when the Wasm module does not need those imports. Global resolution uses
JavaScript expressions; JSBody uses strings embedded in Wasm. This requirement
comes from **JavaScript interop glue**, not Java-to-Wasm compilation itself.

The official `load()` / `defaults()` initialization path always installs this
JSO layer. `noAutoImports` controls module loading, not evaluation, and
`installImports` is too late to prevent the eager constructors. No eval-off
option exists in this pinned loader. See the [official loader API](https://teavm.org/docs/wasm-gc-backend/loader.html)
and the checked stock asset with SHA-256 `d4fc035b410f444f79f49e3890643b8bfd644a02dcfc597e3fcaa8a07bafca08`.

`prepare-csp-runtime.mjs` now replaces those ten expressions after checking that
exact input hash and AST shapes. The rest of TeaVM's loader, Wasm compilation,
initialization, memory and exception machinery stays intact. Ordinary closures
handle arguments, rest parameters, receivers, constructors and exceptions;
global access accepts property paths instead of JavaScript expressions.
`csp-runtime-support.js` implements the compiler's seven distinct, fixed helpers
(nine requests at initialization): null-prototype object creation, array creation
and identity conversions. Unknown helper text fails closed. Tank workers keep
the previous **identity-only** helper override and explicit Wasm import list.
No player source or helper body is converted into a JavaScript script/blob.

This is a **local, version-specific loader patch**, not an upstream-supported
CSP switch. It uses the existing TypeScript parser during asset preparation;
no new package or custom Java runtime was introduced. Preparation is deterministic
for the pinned input/support files, records output/source hashes, and refuses
unreviewed stock runtime changes. Generated code contains no `eval` or Function
constructor. Player Java still compiles exclusively in browser workers.

### Minimum tested policy

The enforced HTTP header on the opaque frame, inherited by its blob worker, is:

```http
default-src 'none';
script-src 'nonce-<random-per-response>' blob: 'wasm-unsafe-eval';
worker-src blob:;
connect-src 'none';
object-src 'none'; base-uri 'none'; form-action 'none'
```

The nonce permits the trusted frame script; blob permission permits preloaded,
verified worker/loader JavaScript. Only Wasm bytecode compilation gets a code
generation exception. JavaScript `eval`, Function, async-function and generator
constructors remain blocked. Removing `wasm-unsafe-eval` blocks startup; the
unmodified loader still fails with the working policy. A legacy `?eval=1` cannot
broaden the header. There is no permissive fallback. This distinction is defined
by [CSP's script-src rules](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src).

### Current browser verification

Headless Chrome 157.0.8103.79, same Windows laptop, fresh disposable profiles:

- **99 differential unit tests** passed against the stock wrapper behavior,
  covering arities 0–31, missing/extra/rest arguments, receivers, constructors,
  exception propagation, fixed helpers and rejection of expressions/unknown bodies.
- **13 CSP browser checks** passed: enforced headers and negative controls,
  actual Java compilation/stateful ticks/source diagnostics, both workers'
  blocked string evaluation/network/storage access, and linear-memory ceiling.
- **22 full experiment checks + 10 follow-up browser checks** passed, including
  collections, runtime failure, infinite ticks, constructors/static initializers,
  both interop attacks, 1/4/12 independent instances, cancellation and actual UI.
  Healthy replies arrived **102–116 ms after each hang started**, before the
  failing worker was stopped in **504–515 ms**. Local dummy logs saw zero guest
  requests; no workers remained after disposal.

Raw results: [CSP policy](results/csp-policy.json),
[full verification](results/csp-verification.json),
[follow-up checks](results/csp-extra.json). Initial performance tables above
remain historical measurements, not a controlled speed comparison with this patch.
Other browsers and lower-end hardware are still unverified.

### Resource and distribution limits

The runtime's **64 MiB linear-memory ceiling is enforced**: requesting growth
beyond it throws `RangeError` without increasing the buffer. It does **not** cap
Java objects in Wasm GC. The stock browser APIs expose no demonstrated hard
per-worker GC heap quota. External deadlines bound ordinary CPU hangs, not
browser-wide memory exhaustion. Keep compiler concurrency/source/cache sizes
bounded and test hostile allocation patterns before public execution; no new
resource-control framework was added here.

All four original compiler/library files plus the prepared loader can be
self-hosted; execution workers need no network permission or CDN. Source/JDK/
TeaVM versions remain pinned. Compiler binary rebuilds were not byte-identical
in the feasibility work; this patch does not solve that. Archive a reviewed
binary bundle with hashes and the corresponding build recipe/source, rather
than treating a newly generated manifest as proof of byte-reproducible Java builds.
For a future reproducible-build milestone, pin the exact builder JDK/vendor and
all resolved dependency checksums, control locale/archive input ordering, and
compare two clean builds. The lightweight CSP transformation already reproduces
the same output hash on repeated preparation; no large rebuild was needed here.

The modified loader retains TeaVM's **Apache-2.0 attribution and a modification
notice**; the support/preparation files and patch must accompany source releases.
OpenJDK's **GPL v2 + Classpath Exception**, applicable corresponding-source
requirements, TeaVM NOTICE, ASM/JZlib and Unicode notices remain unchanged. See
[NOTICE.md](NOTICE.md). Self-hosting does not remove redistribution obligations.

TankScript regression verification also passed **244 Jest tests and 66 existing
JavaScript/TypeScript/Python runner tests**. `git diff --check` passed. Changes
are confined to this experiment; no production build or deployment was needed.

### Isolation checks shared with the original experiment

The dummy app uses `127.0.0.1`; relay frames are served from `127.0.0.2`, with
`sandbox="allow-scripts"` and **no** `allow-same-origin`. Compiler and execution
workers both reported origin `null`. A dedicated-origin fallback was unnecessary
because the opaque-origin configuration worked. No production app or account
was loaded.

- Parent document/local storage reads, frame cookies/local storage, worker
  IndexedDB and origin-private file storage were unavailable/denied. Dummy
  authenticated data was reachable from its own app as a positive control.
- Frame/worker `connect-src 'none'` blocked credentialed fetch, blind POST and
  WebSocket connection attempts. Local dummy endpoint/upgrade logs received zero
  guest requests. Workers receive preloaded verified bytes, not an app fetch
  proxy or arbitrary URL loader.
- Generated Wasm imports are checked by namespace, name and kind; automatic ES
  module imports are disabled and unused host imports are removed. No import-name
  or Java package ban is treated as the sole security boundary.
- A real guest `@JSBody` attack was rejected for requesting `createFunction0`.
  A second attack using the already allowed `createFunction1` name was also
  rejected: its body was not the exact fixed identity helper. Guest helper text
  is never evaluated by that hook.
- Infinite tick, hanging constructor and static initializer workers were
  externally terminated in **505 / 512 / 509 ms**. A thrown Java exception stayed
  in its worker. Startup cancellation and worker cleanup passed.
- The stock loader still fails without JavaScript eval permission. The default
  prepared loader now passes with only `wasm-unsafe-eval`; no JavaScript eval
  permission is available. TankScript's policies and Python implementation were
  not relaxed.

This demonstrates useful local isolation, not a general security certification.
Wasm GC has no demonstrated per-tank hard heap cap. The 64 MiB linear-memory
ceiling does not bound GC objects, compilation memory, thread creation exploits,
or browser-wide resource exhaustion. Memory-abuse resilience, compiler stress
inputs and broader interop fuzzing remain gates for public untrusted code.

## Compatibility, licensing and maintainability

TeaVM is ahead-of-time Java with an emulated class library, not a full browser
JVM. Its [official overview](https://teavm.org/docs/intro/overview.html) describes
closed-world constraints; modern releases have expanded reflection, so do not
assume all reflection is absent. Arbitrary dynamic class loading, JNI, desktop
APIs, and complete JVM/standard-library behavior should not be promised.
Our `java.net` probe failed TeaVM compilation on unsupported `@JSByRef` use in
NIO buffers; the filesystem probe also reported a missing library method. Those
are **compatibility failures**, not proof of safe networking or storage. The
separate native and interop probes test the actual browser boundaries.

Core TeaVM has stable releases; `teavm-javac` is a smaller evolving integration
without a separately verified stable binary release here. This pinned build
needed an upstream SDK fix, missing build metadata, a basename workaround for
public packaged sources, and Windows resource-path normalization. Some TeaVM
diagnostics retain unexpanded `{{m0}}` placeholders and point into library code.
Compiler rebuilds changed the binary fingerprint; byte-identical builds were
not established. Source/dependency versions and per-build hashes are recorded;
a production release should archive a reviewed asset set and its source recipe.
After relocating the build cache, the upstream out-of-process build helper
failed with an RMI connection reset. The documented recipe now runs in one JVM;
that rebuild completed successfully in 1 min 23 s. This is developer tooling
fragility, separate from the measured browser startup costs.

Self-hosting/offline execution after assets are loaded worked without runtime
CDN permission. TeaVM/browser compiler use Apache 2.0; the embedded OpenJDK
compiler carries GPL v2 with the Classpath Exception. These are compatible with
commercial use subject to their actual notice/source obligations; the exception
does not waive compiler redistribution requirements. See [NOTICE.md](NOTICE.md)
and retained licenses. Complete a binary/source inventory before public release.
CheerpJ's [current licensing documentation](https://cheerpj.com/docs/licensing)
allows specified community/evaluation use and distinguishes business and
self-hosted distribution terms; it is not the same licensing model.

## Recommendation and smallest next step

**Continue with TeaVM, as an isolated hardening milestone.** It compiles real
Java locally, works with opaque origins and zero network permission, and permits
small independent runtime instances. Keeping twelve compilers alive offers no
memory advantage over CheerpJ; compiled-code reuse is the important opportunity.
Fresh builds still take seconds, so compilation must remain outside game ticks.

The restrictive CSP gate has passed. The smallest next step is an opt-in Java
adapter milestone for the **complete current snapshot/API**, preserving this
opaque worker/import boundary and keeping Java unavailable by default. Retain
and review the pinned loader patch on upgrades; prefer an upstream static-loader
option when one is available. Exercise bounded memory-abuse cases, additional
browsers and an ordinary lower-spec laptop before public use. A Java adapter can
implement `runTick(snapshot)` / `dispose()` alongside Python's per-tank workers.
BattleEngine and the other runners need no language-specific rewrite.

A later editor milestone can map javac diagnostics to Monaco markers and use
the proven `MyTank` starter. Compile on explicit run/save, preserve source, and
cache by source + toolchain + SDK/bridge version. Nothing here enables Java in
the selector or changes saving/backend validation.

Original feasibility validation: **22 main experiment assertions + 10 follow-up assertions passed**;
**244 Jest tests and 66 existing language-runner tests passed**; production build
succeeded with existing dependency/bundle warnings. Generated `dist/` was removed
after validation. Raw data: [initial comparison](results/measurements-initial.json),
[rebuilt-toolchain verification](results/measurements.json) and
[follow-up checks](results/extra.json). All 28 CheerpJ files retained their original
SHA-256 hashes. No tracked production files changed. No commit, push or deployment
was performed.
