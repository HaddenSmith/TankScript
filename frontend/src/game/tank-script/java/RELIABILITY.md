# Java reliability and resource investigation

Java remains development-only. This report records the earlier reliability
milestone; its runtime findings still apply. The subsequent editor/persistence
integration is described in [README.md](README.md): it adds gated source saving
and limits battles to four Java tanks. No BattleEngine, QuickJS or Python
execution changes are included in either milestone.
The TeaVM assets, loader patch, licenses, import allowlist and frame CSP are unchanged.

## Timeout findings and changes

The old Java request deadline was 100 ms from request creation. It covered asset/
handshake waits, two iframe relay tasks, snapshot conversion, the Java call and
response delivery. This mixed infrastructure latency with program execution.

Measured evidence:

- A controlled 180 ms parent-thread stall expired the old timer **before the
  request was posted**. No slow Java program was needed.
- In the instrumented baseline, all twelve rotating tanks failed in the same
  batch (batch 1,957 of the first long block). Normal worker work was typically
  under 0.2 ms. The failed calls did not return, so their precise internal phase
  could not be recovered.
- With only transport separation applied, a later test captured snapshot
  conversion of **195.2 ms and 124.6 ms**, while each exported Java tick took
  **0.2 ms**. Those were incorrectly charged to the player's program.

The fix separates the budgets. Java retains **100 ms around its constructor or
exported tick call**, checked by trusted worker code. Snapshot conversion occurs
before the tick budget, as Python already does for namespace construction.
A **500 ms external request watchdog**, matching the shared single-worker
watchdog used elsewhere, bounds all preparation, delivery and unresponsive code.
A finite 180 ms tick/constructor is rejected; a genuine infinite call is killed
externally. Cancellation remains immediate rather than waiting for the watchdog.

The opaque frame still owns its worker, but transfers a private data MessagePort
to it. Parent and worker exchange payloads directly; the separate frame control
port handles creation, errors and termination. This removes two relay tasks and
an extra structured clone in each direction without exposing any browser API to
guest Java. All local/transferred port wrappers close during disposal.

Detailed timing is opt-in through `measureTimings: true`; normal play avoids
extra timestamp objects/messages. `getLastRequestTiming()` distinguishes parent
waiting, delivery, snapshot conversion and the exported call. Cross-context
timestamps use [performance.timeOrigin](https://developer.mozilla.org/en-US/docs/Web/API/Performance/timeOrigin).

Remaining uncertainty: a separate earlier sample reported a 126 ms combined
worker call without a conversion/call split. It cannot be attributed precisely.
GC and OS/browser descheduling can still lengthen the exported call itself.
These are wall-clock measurements, **not CPU quotas**. Diagnostic tracing can
provide thread times, but those are not a portable enforcement API available to
the application. We did not raise the 100 ms player budget, subtract guessed GC
time, retry failed ticks, or accept a command from an over-budget program.

A later trace, stopped before explicit diagnostic GC, observed a minor GC with
**7.08 ms wall time but 0.59 ms thread time**. This demonstrates scheduling/wall
time differences; it does not identify the cause of the historical 125/195 ms
conversion pauses, which were not reproduced in that trace.

## Before and after

Chrome 157.0.8103.79, Windows 11, Core Ultra 7 155H, 15.51 GiB RAM. Each count uses
a fresh disposable profile and the same counter/rotation Java source. OS/Vite
caches remain warm. A minimal local page excludes React/Monaco from this
comparison, so browser totals differ from the earlier full-application test.
All comparison runs include timing instrumentation. Cold timings include real
browser javac/TeaVM compilation; warm starts reuse compiled bytes and assets but
create fresh, independent Java objects/workers. Single samples show variation;
they do not establish a guaranteed speedup.

| Java tanks | First tick, fresh profile before / after | Cached start before / after | Short-batch median before / after |
| --- | --- | --- | --- |
| 1 | 6.73 / 6.72 s | 55 / 45 ms | 0.3 / 0.2 ms |
| 4 | 6.20 / 7.23 s | 176 / 147 ms | 0.4 / 0.3 ms |
| 12 | 7.47 / 6.83 s | 403 / 355 ms | 1.0 / 0.6 ms |

The baseline lost all twelve tanks during stress. After the budget-placement fix,
**6,200 batches per count, 105,400 successful tank calls total**, completed with
zero timeouts. Long-block batch p95 latency was 0.3 ms (one tank), 0.4–0.8 ms
(four) and 0.8–1.9 ms (twelve). The controlled 180 ms parent stall then returned
the correct command, with about 0.4 ms measured in the Java call.

Finite 50 ms Java passed; finite 180 ms Java lost its command. Infinite ticks,
constructors and static initializers were terminated in roughly 0.53–0.55 s in
the targeted Chromium sample. A healthy peer returned in about 21–32 ms while
the failing operation was pending. Explicit cancellation completed in about
83 ms for an 80 ms abort timer. These wall-clock samples depend on scheduling;
the supervisor itself cannot run while its browser event loop is suspended.

## Memory findings

The pinned assets total **7,205,654 bytes**. The measured compiled tank is only
**38,135 bytes**. The existing three-entry artifact cache is therefore small for
this program; its maximum remains three modules of at most 8 MiB each, plus
bounded source strings. Runtime initialization receives only the loader and its
compiled module, not the compiler/class libraries.

The compiler-specific probe sampled whole-browser private memory from **354 MiB
baseline to 578 MiB peak**. Its reported JS heap was about **20 MiB after
initialization and 73 MiB after compilation**. After compiler termination there
were zero worker targets; process private memory was still about 503 MiB.
Chrome/allocator/code-cache retention prevents treating process totals as live
Java objects or requiring an immediate return to baseline.

After 6,000 long-block batches, measured total private memory was approximately:

| Java tanks | Before / after transport and budget changes | After diagnostic GC | After worker disposal |
| --- | --- | --- | --- |
| 1 | 627 / 575 MiB | 533 MiB | 528 MiB |
| 4 | 774 / 757 MiB | 585 MiB | 567 MiB |
| 12 | Not comparable: baseline workers had failed / 1,090 MiB | 673 MiB | 614 MiB |

No claim of a reliable whole-browser peak-memory reduction follows from these
samples. Twelve equivalent **no-Wasm workers** also grew from roughly 434 to
772 MiB, then dropped to 449 MiB after diagnostic GC. Message traffic and broader
browser/allocator behavior contribute substantially; the 1.1 GiB number is not
the Java heap. Detaching worker inspectors did not eliminate the growth.
Reported post-GC worker heaps are small, but omit parts of native/browser memory.

A laboratory 4 ms idle opportunity every 64 batches did not materially lower
the observed high-water mark; it was not added to production. GC is used only as
a diagnostic, never as a resource-control mechanism. A persistent compiler pool
would retain its heap/native resources to save mostly startup overhead; the
multi-second Java compilation would remain. We keep compilers short-lived and
reuse compiled artifacts instead. Runtime workers retain state only during their
preview/battle, and reset/completion/cancellation terminate them.

Ten actual four-language matches completed at the unchanged 125-tick stalemate
limit. Whole-browser private memory changed from **785 to 635 MiB** across those
restarts, with zero workers remaining. This endpoint comparison is useful
cleanup evidence, not a proof of leak freedom or a per-tank memory bound.

Recommendations: start with **1–4 Java tanks on lower-memory devices**. The
subsequent editor integration enforces four Java participants per battle within
the existing twelve-total-participant limit. Neither limit is a memory quota.
Workers are not promised separate OS processes; memory exhaustion can affect
other participants or the tab. CPU-failure tests do not prove OOM isolation.
Public use still needs adversarial allocation/compiler testing, lower-spec
hardware, and an explicit resource-abuse policy. The 64 MiB loader setting bounds
only [linear memory](https://teavm.org/docs/wasm-gc-backend/loader.html), not Wasm GC
objects. No hard per-tank Java heap limit has been demonstrated.

## Reproduction and evidence

With the reviewed experiment assets, from the repository root:

```powershell
node tests/browser/javaReliability.mjs --phase=after
node tests/browser/javaReliability.mjs --behaviour
node tests/browser/javaReliability.mjs --diagnostics
node tests/browser/javaReliability.mjs --phase=after --edge
node tests/browser/javaReliability.mjs --behaviour --edge
node tests/browser/javaDebugger.mjs
node tests/browser/javaBattle.mjs --functional-only
npm test -- --runInBand
npm run test:runner
npm run build
git diff --check
```

Optional `--twelve-only --trace`, `--detach-workers` and `--paced` modes are
diagnostic comparisons, not production configuration. Tracing affects memory
and timing and is stopped before explicit diagnostic GC. Edge uses the installed
Windows executable; both tested browsers use Chromium. Firefox/WebKit are not
installed here. Baseline `--phase=before` is a historical expectation check for
the old behavior, not a passing test of current code. The source baseline was
commit `7dbf28e791e7d3a19f6c902d2d1e6d63a1a9b7a9`, with timing instrumentation.

Raw evidence is under `experiments/java-teavm/results/`: `reliability-before.json`,
`reliability-after.json`, `reliability-diagnostics.json`,
`reliability-preparation-pause.json`, `reliability-worker-wall-pause.json`, and
the named behavior/Edge/trace comparisons. Failed intermediate samples are
retained and are not counted as passing tests. Compilation errors are expected
negative cases in the Debugger log. No real backend, account data or external
security targets are used.

## Verification results

- **269 Jest tests in 25 suites**, **66 existing language-runner tests**,
  **99 loader tests**, and **2 Java gating tests** passed.
- Chrome 157 and Edge **157.0.4341.60** each passed 6,200 batches with 1/4/12
  Java tanks (105,400 successful tank calls per browser, no timeouts) and the
  eight targeted finite/hang/cancellation/state checks. Both are Chromium;
  this is not independent Firefox/Safari engine coverage.
- The actual Chromium Debugger passed **18 checks** including restricted CSP,
  networking/storage, command compatibility and other-language regressions.
  The Battle page passed **14 functional checks**, including all language
  pairings, ten full matches, pause/resume, reset, completion and cancellation.
- Production build passed with the Java opt-in variable set; the runtime remains
  excluded. Development-off and production UI/runner gates were rechecked.
  `git diff --check` passed. Generated build output was removed after validation.
- The shared test-only CDP helper now handles expected worker/frame closure
  during inspector attachment and avoids allocating response timers after its
  browser socket closes. This fixes a shutdown race observed in Edge; it does
  not suppress Java execution assertions or change either experiment's runtime.

Changes are confined to the Java runner/session/worker, focused tests/browser
tools, that shared browser-test helper, and documentation/results. No compiler
asset rebuild, dependency upgrade, backend change or BattleEngine edit was needed.

## Editor verification follow-up

The later editor integration exposed startup failures in the Battle browser test,
including a serial run. The instrumented sample timed out `initializeRuntime`
after 513.6 ms: its frame/assets were ready after 189.2 ms, but the worker-ready
handshake never completed and the initialization request was never posted.
No Java constructor or tick had run. The page was visible. This localizes that
failure to worker startup/inspection/scheduling, not a slow Java tank program;
it does not measure each contribution separately.

The shared browser helper deliberately used `waitForDebuggerOnStart: true`, which
[pauses new targets until the inspector resumes them](https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-setAutoAttach).
Ordinary editor/Battle workflow checks now opt out of that pause while keeping
inspection available. Other helper callers retain their default behavior.
An unpaused run also failed; removing the inspector pause alone was insufficient.

The runtime session now separates the trusted frame/worker-ready handshake from
the runtime request. It uses the existing **five-second worker-start bound**;
the compiled Wasm has not been sent and no guest Java is running in that phase.
Once ready, Wasm loading gets its original 500 ms. Construction is a separate
request retaining the **100 ms Java-call budget and 500 ms external watchdog**,
as are subsequent ticks. Compiler initialization/compilation deadlines are
unchanged. Abort and a never-ready worker still close the ports/frame. This is
bounded startup scheduling time, not extra execution time for Java programs.

Failed concurrent/serial/unpaused samples and the paused-worker trace are retained
as `results/editor-battle-*-failure.json` and `results/editor-battle-paused-worker-trace.json`.
Use `node tests/browser/javaBattle.mjs --functional-only --trace-startup` to
record request/frame-ready/post/reply milestones in the trusted parent page.
The observations do not modify guest imports, code, CSP or worker deadlines.
Browser/GC scheduling remains a production risk even without an inspector pause.

Four focused session tests cover delayed startup, the five-second startup bound,
the separate 500 ms Wasm/constructor bound and cancellation. The actual-browser
`--startup-delay` reliability case deliberately delays every trusted handshake
650 ms, then checks retained state, finite over-budget calls, infinite ticks,
constructors/static initializers, cancellation and a healthy peer. No execution
budget is raised to make those tests pass.

The delayed-start Chromium run passed nine checks. Measured from the program
request dispatch, an infinite tick, hanging constructor and hanging static
initializer were terminated after **505.6 / 510.2 / 502.4 ms**, respectively.
Finite 180 ms tick/constructor calls were rejected; a 50 ms call succeeded.
Cancellation took **89.5 ms**, the healthy peer retained its fields and every
frame was removed. These are measured wall-clock samples, not CPU guarantees.
One earlier delay-test assertion incorrectly included the deliberately held
bootstrap in its two-second program-termination check; its failed report is
retained as `results/editor-startup-delay-initial-failure.json`. The new case
measures program dispatch separately; ordinary behavior-test assertions retain
their original wall-clock checks.

## Readiness

The reproduced transport/preparation timeout defects are fixed. This supports
continued **experimental editor/saving/loading integration behind the flag**,
with explicit resource limits and additional testing. Public access is still
gated by unbounded GC/compiler memory, slow-device/background scheduling
coverage, source/binary distribution review, compiler-build reproducibility,
and broader browser/adversarial tests. The later editor integration enables
explicitly opted-in development persistence; public access remains disabled.
