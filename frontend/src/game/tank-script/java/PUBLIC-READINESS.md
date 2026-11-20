# Java public-release readiness

Reviewed November 20, 2026. **NO-GO for public untrusted Java.** Java stays
development-only. The tested data-isolation controls hold, but browser resource
containment and the binary/source release package are not ready.

## Changes in this review

The existing runner now enforces these limits for all callers in a document:

| Resource | Limit |
| --- | --- |
| Starting or running Java tanks | Four, including direct runner calls |
| Active compiler jobs | One; another cold compile fails clearly rather than queuing |
| New compiler starts | Eight in a rolling minute, including failed/cancelled starts |
| Successful compiled-code cache | Three entries and **8 MiB total**, including backing-buffer size |
| Source | Existing 100,000 UTF-16 code-unit limit before worker creation; Express also retains its existing JSON body limit |
| Java constructor / tick | Existing 100 ms program budget and 500 ms external watchdog |
| Trusted worker startup | Existing five-second bound; no Java is sent before its handshake |
| Compiler initialization / compilation | Existing 30 / 120 seconds |

Cached starts do not consume compilation-frequency allowance. Reservations are
released after disposal, errors and idle cancellation; disposal is idempotent.
`getJavaResourceUsage()` exposes counts and cache bytes to trusted-page diagnostics,
not to guest Java. The changes add no scheduler, shared service or new dependency.
Other languages, BattleEngine, authentication and public availability are unchanged.

These are **per-document application guards**, not an origin-wide quota, a CPU
quota, a Java heap cap or protection against someone controlling their own page JS.
The four-Java battle cap remains. Multiple tabs have separate limits and caches.
For opted-in development on a lower-memory machine, prefer one Java tank and one
active Java tab. This is a practical precaution, not a safe public-execution quota.

## Resource and performance evidence

Actual Windows 11 Home 10.0.26300 desktop, Core Ultra 7 155H, 16,658,030,592 bytes
physical RAM, Node 24.21.0. The resource sample used Chrome **158.0.8127.36**.
One disposable profile; OS/Vite caches were retained. Warm starts reused compiler
output, not mutable Java objects. These are wall-clock samples, not guarantees.

| Measurement | Observed |
| --- | --- |
| Cold source compilation through first tick | 9,014.5 ms |
| Four cached independent Java tanks initialized | 217.6 ms total |
| Four-tank command batches, 1,000 batches / 4,000 calls | Median 0.5 ms; p95 1.3 ms |
| Empty browser private memory | 369.3 MiB |
| After cold compiler ended, one runtime | 530.4 MiB |
| Four runtimes after 1,000 batches | 596.5 MiB |
| Two tabs with four runtimes each | 669.8 MiB |
| 128 MiB allocation attempt followed by infinite loop | Sampled profile peak 702.4 MiB; watchdog terminated the tank |
| After 20 starts/resets (one compile, nineteen cached) | 947.6 MiB; zero worker heap replies |
| After repeated compiler failures | 726.9 MiB; zero workers |

The 16 MiB byte array was allocated, touched and retained: the next tick observed
it and returned the expected command. The 64/128 MiB allocation fixtures returned
execution-timeout errors. Those are execution-budget failures, **not enforced
allocation limits**. An allocation primitive can consume memory before control
returns; the watchdog cannot undo a peak or guarantee survival of the renderer.
We did not intentionally drive the machine into OOM. Larger adversarial allocations
and arbitrary pathological compiler inputs remain unverified.

Whole-browser private memory includes native/compiler/JIT/browser/inspector costs.
Worker JS-heap readings are not a complete Java/Wasm GC heap measurement. Later
memory fell naturally, but retained private memory after cleanup is substantial;
this is not proof of either a leak or leak freedom. Forced GC was not used as a
resource-control mechanism. The 64 MiB loader setting limits linear buffers,
[not Wasm GC objects](https://teavm.org/docs/wasm-gc-backend/loader.html).

The lab required 3 GiB free host memory **before launching** its disposable browser.
Bounded allocation probes sampled only its owned process IDs every approximately
100 ms, with a 1.75 GiB profile cutoff. Initial preflight stops were retained;
the guard was clarified to avoid subtracting the browser baseline twice. No user
applications were closed. Sampling can miss short peaks. No unbounded OOM probe
or real authenticated account data was used.

Other genuine probes passed: fifth runner rejected before allocation; two tabs
still create eight runners; second compiler rejected; failed compiles count toward
the eight-per-minute allowance; 100,001 characters rejected without worker work;
a real 100,000-character source compiled; bounded exponential string expansion
reported javac's constant-string limit; a source duplicate could not replace the
trusted entrypoint. Annotation-processing API classes were absent from the SDK;
the pinned `SimpleJavaCompiler.simpleCompile()` also directly runs parse/enter/
attribute/flow/desugar/generate, without the annotation-processing pipeline.
This is not a proof covering every possible malicious compiler input.

Raw data: [completed resource sample](../../../../../experiments/java-teavm/results/public-resources-first-pass.json).
Later reruns are retained separately: a CDP `Target.getTargets` inspection call
stalled, and the next attempt stopped before launching the browser because free
host memory was below the lab's 3 GiB threshold. The inspection change was reverted;
the final harness also explicitly counts the nineteen cached resets. Those later
attempts are not counted as completed allocation tests. The original sample's
"cached resets" label included one necessary recompile after cache eviction.

## Security and browser evidence

The real editor/CRUD workflow uses a new, randomly named MongoDB test database,
removed afterwards. Native policy probes run in the **actual compiler and runtime
workers**, not privileged debugger evaluation. They attempt JavaScript eval,
Function construction, credentialed fetch to a dummy local endpoint, IndexedDB
and OPFS. The existing nonce/Blob/Wasm CSP and opaque origin are unchanged.

The implementation review checked:

- `sandbox="allow-scripts"` without same-origin permission; validated parent/frame
  message sources and opaque origin; private transferred ports; no user source
  interpolated into JavaScript and no authenticated API/storage proxy.
- SHA-256 checked local assets; `noAutoImports`; runtime Wasm module/name/kind
  allowlist before instantiation; exact fixed JSBody helpers. The trusted compiler
  uses its pinned loader's broader helpers inside the same isolated, offline worker.
- Compiler file management is backed by supplied source/class-library/output maps;
  callers supply only `MyTank.java`, with the trusted SDK/entrypoint. No external
  classpath, service registration, package install or URL loader is exposed.
- External deadlines, explicit termination/acknowledgement, cancellation and
  cleanup after failed compilation or execution. The supervisor can itself be
  delayed by browser/OS suspension; worker termination is not hard OOM isolation.
- Real backend tests, including another owner's requests, unauthenticated writes,
  production with the opt-in variable set, disabled/unset modes, Java-list hiding
  and direct Java payloads. The frontend cannot turn on backend Java persistence.

| Tested environment | Result / boundary |
| --- | --- |
| Installed Chromium / Chrome 158, Windows desktop | Genuine editor, source diagnostics, saved Java, Debugger and four-Java battle passed; native policy probes passed |
| Playwright Firefox 159.0, build 1572 | Genuine Gecko compilation/execution, editor/CRUD, battle and native policy probes passed; resized 390 px and 1280 px layouts tested |
| Playwright WebKit 27.2, build 2388, Windows | Genuine WebKit compilation/execution, editor/CRUD, battle and native policy probes passed over local HTTPS |
| Retail Safari on macOS/iOS, physical mobile and lower-memory laptops | Not available / not verified |

The optional engines came from **Playwright 1.65.1**, installed only under ignored
experiment tooling. They are patched automation builds, not certification of
retail Firefox/Safari versions. Viewport changes are desktop emulation, not phone
hardware tests. WebKit rejected the Secure cookie on HTTP loopback; testing used
a disposable self-signed HTTPS certificate without changing application cookies,
CSP or system certificate trust. Its HTTP failure is retained in the results.

Do not infer support from `window.WebAssembly` or a user-agent name alone. Before
a public release, add a small pinned GC/string-builtins/opaque-worker capability
check, with a clear unsupported-browser message that preserves editing/source and
offers another supported language. Never fall back to JavaScript `unsafe-eval`.
No such public enablement or fallback was added here.

## Rebuild and release provenance

Pinned inputs are `teavm-javac` **cf274939233f390b4bc92413c2b057ab14c323d3**,
TeaVM **0.16.0**, OpenJDK `jdk25u`
**6c48f4ed707bf0b15f9b6098de30db8aae6fa40f**, SDK fix
**76b5b53850f74e510ec8588a56a211cf60e9d496**, Gradle **9.1.0** and the existing
checked source/distribution archive hashes. This host used Oracle JDK
**25.0.1+8-LTS-27** for developer builds and Node **24.21.0** for normalization.
That developer JDK is not copied into the web assets.

Two offline `--rerun-tasks --no-build-cache` builds completed in **298.9 / 295.9 s**.
The audit used a separate output folder and regenerated missing Gradle transforms
in a separate cache, reusing pinned downloads. It restored only the upstream
declared JDK compiler/tool source directories from the checked archive rather than
resyncing the whole JDK/test tree. No Java source bytes were changed by that
extraction optimization. This is repeat-build evidence on one host, not a hermetic
cross-host build or a claim of a fully cold dependency bootstrap.

| Asset | Result |
| --- | --- |
| Patched loader | Both builds and working copy: `a3660fc7afd10abd945fbff2043a55e7c50274e6a4ad681b654d78edb95def4d` |
| Normalized compile class library | Both builds match working `babb800117ca3c763849f33407f31eee9800206570212dd37fc019416612b008` |
| Normalized runtime class library | Both builds match working `697fc0d78b9a0dbac92fd784f0723cf2f749aed14c53207ffc32f86dff777ce1` |
| Compiler Wasm, working | `71f3794eea62f99ccec09eee71babf772815f66f2169370203956c83958cdddd` |
| Compiler Wasm, rebuild 1 | `09caba79e8271fce21d306dbc8dffd1771750bec85290eed0d5a256ae36bc1b0` |
| Compiler Wasm, rebuild 2 | `b88def872742041401c044b23fdceab051cb98b6825139d84c83f24977b1a6f2` |

**The compiler is not byte reproducible.** The two new Wasm files differ in the
code section, not merely timestamps/custom debug sections; their differing bytes
have not been proven semantically equivalent. Working assets and pins were not
replaced. Loader/class-library reproducibility does not resolve this compiler gate.

The audit recorded **47 distinct resolved module coordinates** and artifact
SHA-256 values, including host-only build plugins, in
[compiler-dependencies.json](../../../../../experiments/java-teavm/results/compiler-dependencies.json).
Runtime/class-library inputs are distinguished from buildscript dependencies.
Key bundled dependencies include ASM 9.8, relocated ASM 9.10.1, HPPC 0.10.0,
Rhino 1.9.1 and JZlib 1.1.3. Local project artifacts labeled `unspecified` are
from the pinned source revision, not unversioned remote downloads.
There is still no complete release dependency-verification lock or pinned build
JDK distribution. `mavenLocal()` in the original upstream recipe is another reason
not to call it hermetic. Archive reviewed artifacts and exact corresponding
sources; do not automatically accept a changed checksum.

## Licensing and distribution

This is a technical inventory of authoritative texts, not a legal clearance for
the combined binary. Browser delivery of the compiler is object-code distribution,
not simply running a GPL program privately on a server.

| Component | Verified license / release obligation |
| --- | --- |
| TeaVM, browser-compiler source and loader | Apache-2.0; retain license, relevant NOTICE/attribution and modified-file notices ([section 4](https://www.apache.org/licenses/LICENSE-2.0)) |
| Bundled OpenJDK javac / definitions | GPLv2 with the Classpath Exception on designated files; prepare corresponding source and build material for the compiler distribution. The exception does not remove redistribution duties for the compiler itself. Review the actual linked/derived distribution rather than assuming TankScript's whole frontend must change license |
| Rhino 1.9.1, including relocated code | MPL-2.0 covered-source availability and notices when distributing executable form ([section 3](https://www.mozilla.org/en-US/MPL/2.0/)); preserve included MIT/Lucent notices too |
| HPPC 0.10.0 | Apache-2.0; retain Carrot Search/contributor notices |
| ASM 9.8 / relocated 9.10.1, JZlib 1.1.3 | BSD-style notices/conditions retained |
| OpenJDK jopt-simple 5.0.4 | MIT; exact notice retained from the checked OpenJDK source archive |
| Included Unicode/CLDR data and TeaVM class library | Retain their data/software notices and TeaVM's Apache/Joda attributions; finish exact included-resource inventory |

The previous short notice omitted Rhino, HPPC and jopt-simple details. This review
adds their license/notice texts, exact upstream source-archive hashes and notice
provenance, and exposes those texts through the existing development asset route.
The relocated Rhino POM's generic Apache metadata does not override its upstream
MPL source headers. Original source JARs were downloaded for inspection only;
they are ignored tooling, not new application dependencies or published binaries.

**Still required:** a complete binary-to-source/notice inventory, including the
relocation recipe and covered modifications; a verified source bundle or compliant
source-delivery arrangement for the exact binary; and review of the combined
GPL/Classpath/MPL distribution terms. License texts and upstream links alone do
not complete that release work. No proprietary CheerpJ assets are distributed.
See [NOTICE](../../../../../experiments/java-teavm/NOTICE.md) and the retained
[license files](../../../../../experiments/java-teavm/licenses/).

## Remaining blockers, ranked

1. **High — availability/resource containment.** No demonstrated hard Java/Wasm GC
   or compiler heap quota. A deadline cannot prevent an allocation peak/OOM, and
   tabs multiply resources. Cleanup does not promptly restore private memory.
2. **High — distribution/source compliance.** The corresponding-source/notice
   release package and combined-license review are incomplete.
3. **Medium — reproducible compiler provenance.** Repeated Wasm code bytes differ;
   complete dependency verification and a pinned build JDK are missing.
4. **Medium — production delivery validation.** Assets currently exist only behind
   the Vite development plugin. The deployment file allowlist currently excludes
   `.bin`, `.md` and `.txt`; a reviewed versioned asset/source/notice delivery design
   and staging CSP test are needed before changing either hard production gate.
   Production reverse-proxy headers were not probed or changed live.
5. **Medium — compatibility coverage.** Retail browsers, real iOS/Android hardware,
   background throttling and lower-memory student devices remain unverified.

The subsequent [memory-containment investigation](MEMORY-CONTAINMENT.md) completed
that feasibility decision: the current WasmGC/browser design cannot practically
enforce a compiler-wide or per-tank heap quota. Its next proposed milestone is a
gated one-Java mode/resource notice and a narrow compiler linear-cap check, rather
than more OOM tests or a custom accounting system. A future own/curated-code pilot
would require explicitly accepting local availability risk. The source/license
release package remains independently required; public Java stays disabled.

## Verification results

- 285 Jest tests in 27 suites, 37 real-backend integration tests, 66 existing
  language-runner tests, 99 loader tests and three runner-gating tests passed.
- The unchanged `npm run test:runner` initially reported one or two QuickJS
  allocation fixtures as `EXECUTION_TIMEOUT` rather than the expected heap
  `RUNTIME_ERROR` in the restricted tool environment; a serial attempt also
  hit that timing distinction. The same unmodified command passed all 66 outside
  that environment, with all guest limits intact. This is timing-sensitive
  regression evidence, not proof that process restrictions were the sole cause.
- Chromium passed 18 actual Debugger and 14 functional Battle checks, including
  ten complete mixed-language matches. Each of Chrome/Firefox/WebKit passed nine
  real-backend editor/native-policy checks (27 total); temporary databases were
  removed. The completed bounded resource sample contains 15 checks. Later
  inspection/preflight stops are documented above and are not passing samples.
- The production build passed with `VITE_EXPERIMENTAL_JAVA=true`; the output
  contained the 258-byte rejecting Java adapter and no compiler/class-library or
  execution-worker assets. Four actual browser checks passed for production and
  development-off Debugger/Battle gates. Existing bundle/directive warnings remain.
  `git diff --check` passed and generated `dist/` was removed after verification.

## Reproduction

With reviewed assets and private test-DB configuration:

```powershell
npm test -- --runInBand
npm run test:runner
npm run test:integration
node --test tests/unit/tanks/javaGating.test.mjs experiments/java-teavm/csp-runtime.test.mjs
node tests/browser/javaResources.mjs
node tests/browser/javaEditor.mjs --security
node tests/browser/javaEditor.mjs --browser=firefox --security
node tests/browser/javaEditor.mjs --browser=webkit --https --security
node tests/browser/javaDebugger.mjs
node tests/browser/javaBattle.mjs --functional-only
npm run build
git diff --check
```

Run resource/browser suites serially. Optional browser tools are pinned Playwright
1.65.1 under `experiments/java-teavm/generated/browser-tools/`, with Firefox 1572
and WebKit 2388 under its `browsers/` directory. No root dependency is added.
To install that separate tooling:

```powershell
npm install --prefix experiments/java-teavm/generated/browser-tools --no-save --ignore-scripts --no-package-lock playwright@1.65.1
$env:PLAYWRIGHT_BROWSERS_PATH = (Join-Path $PWD 'experiments/java-teavm/generated/browser-tools/browsers')
node experiments/java-teavm/generated/browser-tools/node_modules/playwright/cli.js install firefox webkit
```

For HTTPS tests create `generated/browser-tools/local-cert/key.pem` and `cert.pem`
with a disposable localhost/IP SAN certificate; only the isolated test context
accepts that self-signed certificate. The full Debugger suite waits one rolling
quota window between independent cold-compilation groups rather than bypassing
the new eight-per-minute limit.

Rebuild separately with `experiments/java-teavm/check-rebuild.ps1`, then
`node experiments/java-teavm/compare-rebuilds.mjs`. The recipe needs the pinned
archives/dependency downloads prepared by `setup.ps1`, Oracle JDK 25.0.1 on this
host (or an explicitly reviewed build JDK), and about ten minutes for two compiler
builds. Inspect results rather than replacing pins. `dependency-inventory.gradle`
adds only an audit Gradle task; run it with `-I` and set
`TANKSCRIPT_DEPENDENCY_REPORT` to the desired JSON path.

No commit, push, deployment, public enablement, working compiler replacement,
BattleEngine change or other-language runtime rewrite was performed.
