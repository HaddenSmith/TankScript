# CheerpJ 5.0 / Java 21 proof of concept

Measured November 19, 2026. **The experiment works, but full TankScript Java
integration is not approved by this result.** App-origin isolation passed the
focused local checks; the opaque-origin configuration did not finish startup.
The CDN permission, deployment, and performance tradeoffs remain material.

## What worked

- CheerpJ 5.0 reported Java `21.0.13.0.3-internal`. OpenJDK's `javac` compiled
  player source entirely inside a browser worker. The server has no compiler API.
- A real `MyTank` class used an integer field, variables, a loop, conditionals,
  a helper method, and an immutable Java snapshot record. The same object returned
  `shoot`, then `moveRight`, retaining its field between ticks.
- Each benchmark worker compiled once and ran 51 ticks, including 50 steady-state
  samples. No compilation happens in the tick path.
- Invalid source produced `illegal start of expression` at line 4, column 25.
- Groups of 1, 4, and 12 independent JVM workers completed. This is one JVM per
  tank, not twelve objects sharing a single JVM.
- All 15 focused assertions in `verify.mjs` passed, covering functionality, local
  isolation, termination, and cancellation. These labels describe the tested
  assertions, not a general security certification.

## Actual measurements

Machine: Intel Core Ultra 7 155H, 22 logical processors, 15.51 GiB system RAM,
Windows 11 Home. Browser: headless Chrome 157.0.8103.79, without CPU/network
throttling, with Chrome DevTools Protocol instrumentation. Managed extensions
were present despite the test browser's disable-extensions flag. This is a
modern laptop, not evidence about lower-end student machines.

| Independent tanks | Group ready | Group compilation | First tick, per tank | Steady tick median / p95 | Worker JS heaps used |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 23.6 s | 22.4 s | 131 ms | 0.6 / 2.0 ms | 63 MiB |
| 4 | 16.4 s | 27.0 s | 242–277 ms | 1.0 / 5.1 ms | 255 MiB |
| 12 | 38.3 s | 69.0 s | 185–359 ms | 1.4 / 14.1 ms | 670 MiB |

Ready and compilation columns are sequential group wall times: about 46 s,
43 s, and **107 s** before the first tick. Actors within a group start and compile
in parallel. The first group used a fresh Chrome profile; the next two reused
that profile with whatever HTTP range caching the browser provided. These are
one run per group, not repeated statistical startup benchmarks.

Runtime/CDN encoded response bytes across startup, compilation and ticks were
17.7 MiB, 28.8 MiB, and 49.6 MiB for the three groups. Those are CDP-reported
network bytes, including reported response overhead, **not isolated initial
runtime-download sizes**. Browser resource timing reported zero cross-origin
sizes, so those values were not used. No runtime content is saved in the report.

There were 50, 200, and 600 steady-state per-tank samples. Maximum steady tick
times were 16.6, 13.9, and 81.1 ms. Complete group round-trip median / p95 times
were 1.3 / 8.0, 3.2 / 8.0, and 8.0 / 45.1 ms. These tiny strategies are not a
benchmark of complex player algorithms. First-tick costs exceed the current
100 ms interpreter target, although they fit the 500 ms watchdog here.

Memory is the sum of CDP `Runtime.getHeapUsage().usedSize` for live Java workers,
without forcing collection. It excludes other browser processes and is not
total RAM, peak RAM, or a per-tank heap limit. Steady-state CPU behavior is
encouraging; cold latency and replicated JVM/compiler state need work.

## Isolation and safety findings

The dummy app used `127.0.0.1`; Java frames used `127.0.0.2`. Different ports
alone would not isolate cookies. No real TankScript account, backend endpoint,
database, or application process was involved.

- Frame access to the parent document and local storage threw `SecurityError`.
  The execution host saw no dummy app cookie or local-storage canary.
- Guest Java called a diagnostic native method with worker-level browser
  capabilities. It could not access a document/localStorage; its own IndexedDB
  lookup returned no app canary. Credentialed fetch and a `no-cors` POST to the
  local dummy app were blocked by CSP.
- A separate guest `java.net` request returned `java.io.IOException: Network
  Error` in 240 ms. Server counters recorded **zero guest requests** to the
  private/probe endpoints. A positive control confirmed that the dummy app's
  authenticated endpoint worked from its own origin.
- Guest Java **could** write and read `/files/guest-java-probe.txt`, backed by
  the execution origin's browser storage. That is separate from app storage,
  but it is not a zero-storage runtime or per-tank storage boundary. Multiple
  Java workers on the same execution origin must be treated accordingly.
- The 500 ms external watchdog stopped an infinite tick in 510 ms, a hanging
  constructor in 509 ms, and a hanging static initializer in 511 ms. The main
  heartbeat advanced 10–11 times during each hang. Frames were removed; a fresh
  worker could subsequently start. Maximum measured main-heartbeat scheduling
  delay across the full run was about 16 ms.
- Startup cancellation rejected readiness and removed its frame. Removing
  imports was never used as the security boundary.

Two configurations were unsuitable in this test:

1. Without general JavaScript evaluation permission, CheerpJ's default engine
   failed at its internal `new Function` call. `wasm-unsafe-eval` alone was not
   sufficient. Only the experiment frame's optional CSP grants `unsafe-eval`;
   all production policies remain untouched.
2. The opaque-origin worker with JIT permission did not complete its Java library
   startup before the 120-second supervisor deadline. The exact cause was not
   established. This is not proof that every possible opaque-origin arrangement
   is impossible; this configuration was not demonstrated usable.

The working frame's CSP still permits CheerpJ's official 5.0 runtime CDN and the
local public bridge-asset path. **Zero-egress guest execution has not been
demonstrated.** No guest network probe was sent to external targets. Do not
describe the result as a drop-in replacement for Python's opaque-origin,
HTTP-blocked design. A real deployment would need a dedicated credential-free
execution host, verified cookie scoping, narrowly controlled asset access, and
additional browser/adversarial testing. No Java integration should proceed if
those requirements cannot be satisfied.

## Implementation and deployment limits

The locally compiled JAR contains only our trusted bridge. Player source is
compiled by browser javac using an in-memory file manager and custom class
loader. `/str/bridge.jar` avoids relative `/app` fetch URLs, which do not resolve
normally in Blob workers. One library-mode session is used per worker; trying a
second session produced `Only one library thread supported` during development.

The simulated interface is `tick(Snapshot) -> action string`. It shows how Java
could fit the existing command/snapshot boundary, but it is not a full Java SDK,
mixed-language battle integration, Monaco support, or persistence integration.

The experiment uses the official CDN. No proprietary runtime assets are copied
into the repository or served by the local server. Offline operation was not
tested and the current CDN configuration requires network access. The
[CheerpJ licensing documentation](https://cheerpj.com/docs/licensing) permits
technical evaluation and describes Community eligibility/attribution, business
Application licensing, self-hosting, redistribution, and offline arrangements.
A publicly accessible TankScript deployment must satisfy its applicable terms;
this evaluation does not establish a free self-hosting or future commercial
redistribution right. The demonstration includes a Built with CheerpJ credit.

## Recommendation

**Try a small TeaVM comparison before committing to CheerpJ integration.** Java
itself is feasible. CheerpJ's steady execution and external termination worked,
but the straightforward per-tank JVM/compiler approach has substantial startup
cost and needs a different isolation/deployment arrangement from Python.

The smallest next step is to use exactly this simulated snapshot and alternating
tick fixture with a pinned `teavm-javac`/Wasm toolchain, then compare compilation,
startup, memory and termination under an opaque frame with guest HTTP blocked.
TeaVM has not been measured here and is not assumed faster or safer. Its browser
compiler's release packaging and OpenJDK/TeaVM licence notices need checking too.

If CheerpJ is preferred for compatibility, the next experiment should instead
separate a reusable compiler worker from per-tank execution and transfer cached
bytecode, then repeat the dedicated-origin security tests. That might reduce
cost; no optimized performance claim has been measured.

Raw data: [full checks and measurements](results/measurements.json),
[isolation configuration smoke results](results/smoke.json), and
[Start/Compile/Tick/Stop UI check](results/ui.json). The actual UI also passed a
fresh Java 21 compilation, alternating ticks and Stop cleanup. The initial smoke
run reused cached resources between configurations; its numbers are not the
cold benchmark above. The production working tree remained unchanged.
