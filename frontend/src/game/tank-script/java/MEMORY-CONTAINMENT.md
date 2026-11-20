# Java memory-containment decision

November 20, 2026. **A reliable per-tank or compiler-wide memory quota is not
practical with TankScript's current browser-only TeaVM WasmGC design.** Stop
looking for a loader setting that supplies one. The existing data-isolation
boundary remains useful; it is separate from protection against local memory
exhaustion. No production runtime, feature flag, game mechanic or execution
deadline was changed in this investigation.

Keep Java development-only for now. An explicitly opted-in, limited Java pilot
could eventually accept the remaining availability risk; unrestricted automatic
execution of community Java is not recommended. JS/TS/Python can remain the
public languages while Java's distribution work is completed.

## What allocates memory

The browser compiler is itself a TeaVM WasmGC program. Javac source/AST/symbols,
class files, TeaVM's dependency graph/IR/optimizers, SDK resource maps and generated
outputs use ordinary Java objects/arrays in that program. The pinned compiler's
`setSdk()` and `setTeaVMClasslib()` copy input into Java arrays/resource maps;
`generateWebAssembly()` constructs a new `WasmGCTarget` and builds into an
in-memory output map. Source/output clearing does not discard all compiler caches.
See the [pinned compiler source](https://github.com/konsoletyper/teavm-javac/blob/cf274939233f390b4bc92413c2b057ab14c323d3/compiler/src/main/java/org/teavm/javac/Compiler.java)
and the locally reviewed, SDK-backported file hash in the
[source index](../../../../../experiments/java-teavm/results/memory-source-index.json).

There are also JavaScript strings, import/export wrappers, asset ArrayBuffers and
structured clones, plus native browser/JIT/code/stack/allocator costs. A WebAssembly
linear-memory maximum covers only one part of these allocations.

| Allocation / limit | Compiler | Tank runtime |
| --- | --- | --- |
| Linear `WebAssembly.Memory` | Existing loader default is approximately 2 GiB maximum; this experiment enforced **16 MiB** | Existing maximum is **64 MiB**; this experiment enforced **4 MiB** |
| Java objects and ordinary primitive/reference arrays | WasmGC; no exposed per-instance heap quota | WasmGC; no exposed per-tank heap quota |
| JS strings/helpers, browser code/JIT/stack and native allocations | No configurable whole-worker quota from web APIs | Same limitation |
| Source input | Existing 100,000 UTF-16 code-unit guard before runner startup | Same saved-source guard; not a heap bound |
| Emitted Wasm / successful source cache | Adapter rejects oversized returned backing buffers; three entries and **8 MiB total** | Bounds cached code bytes, not object state or native compiled-code memory |
| Worker count | One compiler per document | Four starting/running Java tanks per document, and four per battle |

The emitted-output check runs **after** compilation and transfer. It cannot stop
the compiler allocating an oversized result or intermediate data first. Likewise,
a small source can request a large array or induce expensive analysis; source size
helps but does not give a useful worst-case compiler-heap bound. Fixed asset hashes
bound the distributed input files, not their expanded/native representations.

## Why the linear cap does not cap Java

In TeaVM **0.16.0**, resolved source commit
`e87d452e4bd70c77b9e19314a46c3d6971c148b6`, the
[array generator](https://github.com/konsoletyper/teavm/blob/e87d452e4bd70c77b9e19314a46c3d6971c148b6/core/src/main/java/org/teavm/backend/wasm/generate/classes/WasmGCNewArrayFunctionGenerator.java)
emits WasmGC array construction followed by an object wrapper; it does not route
ordinary arrays through the bounded linear allocator. The
[class generator](https://github.com/konsoletyper/teavm/blob/e87d452e4bd70c77b9e19314a46c3d6971c148b6/core/src/main/java/org/teavm/backend/wasm/generate/classes/WasmGCClassGenerator.java)
also emits GC structs. The separate
[linear allocator](https://github.com/konsoletyper/teavm/blob/e87d452e4bd70c77b9e19314a46c3d6971c148b6/core/src/main/java/org/teavm/runtime/heap/Heap.java)
checks its own maximum; that check is not consulted for ordinary GC allocations.

TeaVM's [loader API](https://teavm.org/docs/wasm-gc-backend/loader.html#memory)
documents its memory options for direct buffers and data transfer. `onResize`
observes that linear memory, not GC allocations. The pinned patched loader creates
an actual `WebAssembly.Memory` with a maximum, which the browser enforces.
WasmGC objects are instead managed by the browser VM, as described by
[V8](https://v8.dev/blog/wasm-gc-porting). Java strings can also use JS string builtins.
No supported live-GC-heap budget/allocation-denial hook was found in the reviewed
TeaVM target/loader APIs.
Browsers have their own allocation/heap limits and failure behavior; those are
not a portable, application-configured per-tank quota.

The shared `heapBytes: 16 MiB` setting belongs to the existing QuickJS interpreter;
Java does not acquire that interpreter limit by sharing the snapshot protocol.

## Controlled browser results

Raw data: [memory-containment.json](../../../../../experiments/java-teavm/results/memory-containment.json).
Windows 11 Home 10.0.26300, Core Ultra 7 155H, 16,658,030,592 bytes physical RAM,
Chrome **158.0.8127.36**, Node **24.21.0**. One disposable desktop browser profile;
no backend, accounts or external test endpoints. OS/Vite caches were retained.
The fresh-compiler comparison is a new worker in the same warmed browser, not a
second fresh profile. No forced GC or Java compiler rebuild was used.

| Phase | Browser private MiB | Active worker `usedSize`, MiB |
| --- | ---: | ---: |
| Empty browser | 363.6 | — |
| Compiler initialized | 458.5 | 19.85 |
| First compilation | 540.0 | 72.40 |
| Reused compiler, second / third compile | 559.9 / 551.0 | 79.21 / 80.42 |
| Reused compiler terminated | 505.7 | — |
| Fresh worker compiled same program | 650.8 | 73.87 |
| After six runtime resets, all frames removed | 678.8 | — |
| Five seconds later, without forced GC | 528.9 | — |

Compiler initialization took **531 / 910 ms**. The reused worker accepted three
compilations of two source variants: **7,246 / 8,664 / 5,022 ms**. A fresh compiler
then took **6,348 ms** for the original program. These samples do not demonstrate
a consistent speedup from compiler pooling. Reuse keeps SDK/class caches and a
substantial heap alive. Retain the current short-lived compiler and compiled-code
cache rather than adding a pool; full reuse correctness was not investigated.

The compiler's current linear memory was **2,555,904 bytes**. Its 16 MiB maximum
rejected a growth request that would cross that ceiling with `RangeError`, while
its VM heap readings substantially exceeded 16 MiB.

| Java byte-array payload | Allocation/touch call | Retained on next tick | Runtime linear memory before / after | Worker `usedSize` before / after, MiB |
| --- | ---: | --- | --- | --- |
| 8 MiB | 7.1 ms | Yes | 2,162,688 / 2,162,688 bytes | 0.54 / 8.55 |
| 16 MiB | 17.1 ms | Yes | Same | 0.54 / 16.55 |
| 32 MiB | 29.5 ms | Yes | Same | 0.54 / 32.55 |

Each runtime first rejected linear growth beyond its **4 MiB** ceiling, then
successfully allocated/touched the larger Java array and returned `shoot`.
The next tick returned `moveRight`, observing retained state. The **100 ms** call
budget and **500 ms** watchdog were unchanged. A time budget clearly does not
imply a comparable memory budget. No OOM or unbounded allocation was attempted.

`usedSize` is the inspector's worker VM-heap reading, including Java/WasmGC and
JavaScript objects; it is **not an exact Java-only heap meter**. Linear byte length
is exact for the observed buffer. Browser private memory includes native/JIT,
other processes and allocator retention. In particular, the browser total fell
after the 8 MiB allocation as old compiler memory was reclaimed; subtraction of
browser totals would give a misleading Java-allocation result.

### Test stopping rules and coverage

This smaller lab requires **2.5 GiB** free host memory before browser launch,
uses one compiler/runtime at a time, and requests at most 32 MiB array payload.
A separate local supervisor stops only the identified disposable profile if it
exceeds **1 GiB private memory**, free host memory drops below **1 GiB**, or the
lab exceeds four minutes. The completed sample started with **3,895.6 MiB** free;
sampled profile peak was **687.2 MiB** and sampled minimum free host memory was
**3,238.9 MiB**. No stopping threshold was reached.

OS queries made the observed sampling interval **2.59–3.29 seconds**, despite a
250 ms requested delay; short peaks can be missed. The supervisor is a lab
precaution, not proof of OOM containment. Its OS/CDP access is unavailable to a
normal webpage and is not an application safeguard. The existing larger
`javaResources.mjs` lab's 3 GiB / 1.75 GiB stopping rules remain unchanged.

Four browser observations passed: compiler linear ceiling; compiler reuse/fresh
comparison; retained arrays exceeding the runtime linear ceiling; reset cleanup.
The existing Java runner/worker/session tests passed **23 tests in three suites**;
the loader and production-gating checks passed **102 tests**. The full application
suite was not rerun for this experiment/documentation-only change; its prior
readiness results remain recorded separately.
The production build passed with the Java opt-in variable set, still emitting
only the rejecting Java adapter. Generated `dist/` was removed afterwards;
`git diff --check` passed. Existing bundler warnings remain.
Two initial harness setup errors (string escaping and a shadowed variable) are
retained separately and not counted as passing runs. The final supervisor also
checks root-process identity and stops at its deadline; Java was not rerun merely
to exercise those host-side safety branches. The earlier readiness sample's
larger allocations, thousands of calls and repeated resets remain historical
evidence; they are not newly repeated measurements here.

## Practical strategies

| Strategy | Enforceability | Cost / benefit / limitation |
| --- | --- | --- |
| Existing deadlines and worker termination | Enforces cancellation/disable behavior when the supervisor runs; no allocation maximum | Low complexity, preserves responsiveness for loops; cannot undo an allocation peak or guarantee browser survival |
| Source/output bounds, one compiler, compilation-rate limit | Hard checks on accepted input, retained output and starts per document | Low cost; controls common churn, not compiler intermediates or extra tabs |
| Bounded compiled cache and short-lived compilers | Hard retained-code bounds; disposal removes worker ownership | Already implemented; allocator/native memory reclamation is asynchronous |
| Lower loader linear maximum | Hard maximum for that buffer | Small change and little expected overhead; does not cover normal Java arrays/objects or JS/native memory |
| Restrict API/imports and libraries | Enforces permitted capabilities | Essential for networking/storage security; plain `new byte[n]` requires no dangerous import |
| Per-array size check / source rewriting | Can reject selected patterns only | Many smaller arrays, object graphs, clone/multi-array paths, strings and library allocations bypass a naive check; not a heap limit |
| Whole-program allocation instrumentation | Potential conservative lifetime-allocation budget, if every path is covered | High compiler/runtime maintenance and per-allocation overhead; exact VM sizes and timely GC reclamation are unavailable. Must cover libraries, intrinsics, JS strings and the compiler too; not a small supported loader hook |
| Separate execution origin/process | Origin isolation protects data; website cannot assign process memory quotas | Can improve crash separation on some browsers; no cross-browser guarantee of one process per tank or bounded device memory |
| Externally supervised process/container | Can enforce OS-level resource limits when correctly configured | Different architecture with operational/security costs; not implemented or moved to a backend in this task |

The [Worker API](https://html.spec.whatwg.org/multipage/workers.html#workeroptions)
has no browser heap-limit option. Browser-origin boundaries and
[Chromium site isolation](https://www.chromium.org/developers/design-documents/site-isolation/)
are not web-configurable RAM quotas. An asynchronous memory monitor can observe
growth after allocation; it cannot reliably reject the allocation beforehand.

### Other TeaVM backends

- **JavaScript:** still relies on the browser's JS heap when executed natively;
  no hard browser heap quota. Executing generated JS inside a bounded interpreter
  is a different adapter/compiler project with compatibility/performance work;
  it would not by itself bound the existing browser javac/TeaVM compiler.
- **Old non-GC Wasm/WASI:** removed in
  [TeaVM 0.14](https://teavm.org/docs/release-notes/0.14.0.html), absent from the pinned
  [0.16 target selection](https://github.com/konsoletyper/teavm/blob/e87d452e4bd70c77b9e19314a46c3d6971c148b6/tools/core/src/main/java/org/teavm/tooling/TeaVMTool.java).
  Do not downgrade to resurrect an abandoned backend as a small fix.
- **C:** supported and exposes a managed-heap maximum in the
  [official tooling](https://teavm.org/docs/c-backend/getting-started.html). C plus
  a separately bounded Wasm toolchain could provide a more useful managed-heap
  boundary, but C generation/linking in the browser and the compiler's own memory
  remain separate problems. The current browser compiler exposes WasmGC output;
  this is not an option change. No such pipeline was built or certified here.
- **WasmGC plus Emscripten interop:** shares linear memory for native libraries;
  it does not move the Java GC heap into that buffer.

## Recommendation and smallest next milestone

Do not build a bespoke GC/accounting system or conduct larger OOM tests. Strong
compiler-wide/per-tank containment is an architectural requirement the current
browser design cannot meet. That does not mean every local availability risk
must be eliminated before a coding game can exist.

For now retain **one compiler per document, eight new starts/minute, 100,000 source
code units, three cached programs / 8 MiB total**, and the existing **100/500 ms**
budgets. Keep the four-Java development cap for local tests; prefer **one Java tank
and one active Java tab on lower-memory devices**. A future explicitly experimental
pilot should start with **one Java participant per battle/document**, with the
multi-tab limit described as advisory rather than an enforceable origin-wide cap.

The tested 16 MiB compiler / 4 MiB runtime linear ceilings are **probe settings**,
not proven compatibility limits for all Java libraries. Keep the current 64 MiB
runtime setting for now. An explicit **64 MiB compiler linear ceiling** is a
reasonable narrow follow-up to validate across supported workflows, rather than
leaving the loader default; it must never be labeled a Java heap limit.

The practical choice is:

1. **Recommended today:** JS/TS/Python public; Java development-only. Finish the
   corresponding-source/notice and reproducibility work independently.
2. **Reasonable future pilot if local crash risk is accepted:** explicit consent,
   capable desktop browser, one Java tank, and only a player's own/curated Java
   initially. Do not automatically run arbitrary community Java for visitors.
   Warn that execution may use substantial memory or close the tab; preserve
   source and provide a stop path. Licensing/release requirements still apply.
3. **If strong containment for hostile community Java is mandatory:** separately
   investigate an OS-supervised architecture. Do not promise the current browser
   worker design meets that requirement or silently change the deployment model.

**Smallest next implementation milestone:** an experimental one-Java mode with a
clear resource notice, plus the narrow compiler-linear-cap compatibility check.
Keep both server/client public gates off. This provides a reviewable pilot policy
without another runtime rewrite; completing source/license delivery remains a
separate prerequisite before any public pilot. No public enablement is authorized
by this report.

## Reproduce

With the existing reviewed assets and installed project dependencies, from the
repository root on Windows:

```powershell
node experiments/java-teavm/memory-containment.mjs
node --test tests/unit/tanks/javaGating.test.mjs experiments/java-teavm/csp-runtime.test.mjs
npm test -- --runInBand --runTestsByPath tests/unit/tanks/javaTankRunner.test.js tests/unit/tanks/javaTankWorker.test.js tests/unit/frontend/javaWorkerSession.test.js
```

The script reuses the actual pinned compiler, patched loader, SDK, action collector
and worker/frame implementation, with trusted diagnostic requests and smaller
linear ceilings in its private test worker source. It never edits those application
files. Array allocations retain the same external deadlines; failed calls are
disposed. It uses no new package, Java build, MongoDB or authenticated data.
Source URLs/hashes are recorded in `results/memory-source-index.json`. Source
inspection included the pinned local compiler and TeaVM files, rather than only
the rolling documentation. No commit, push or deployment was performed.
