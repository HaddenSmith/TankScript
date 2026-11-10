# Standalone TankScript runner

The runner uses the browser's QuickJS implementation and action allowlist. Each battle gets a new Linux container, and each tank gets its own QuickJS runtime. Scripts compile once, keep private state across ticks, and return a validated action, no action, or a controlled error. The caller supplies snapshots and owns all battle rules.

## Run locally

Use Node.js 24 and a local Linux Docker engine with cgroup v2, the CPU, memory and PID controllers, swap accounting, and the default seccomp profile. Docker must be available to your development user. From the repository root, after installing the project's npm dependencies:

```sh
docker build -f service/tank-runner/Dockerfile -t tankscript-runner:local .
npm run test:backend-runner
npm run test:backend-runner:docker
npm run bench:backend-runner
```

The build fetches the locked QuickJS dependencies. The running container has only loopback networking. Use a local Docker context so the container tests and resource readings refer to the intended host.

Without Docker, run the process tests and `npm run bench:backend-runner -- --local-fixtures`. These commands use trusted fixtures in a native Node subprocess and exercise the QuickJS and IPC layers. Use the Docker commands to check Linux containment and measure container startup, resource use, and removal.

## Call the runner

```js
import { startDockerTankRunner } from './service/tank-runner/client.js';

const runner = await startDockerTankRunner(participants, { signal });
try {
  const { results } = await runner.runTick(livingTankSnapshots);
  // Apply the returned commands using the trusted battle rules.
} finally {
  await runner.dispose();
}
```

`participants` is an array of `{ tankId, source }` entries. Snapshots use the existing TankScript fields. Check `runner.initialization` for per-tank compile failures. The optional abort signal closes the runner and removes its container.

Requests and replies use one UTF-8 JSON object per line over stdin and stdout. Each request carries an increasing ID and one of four operations, `initialize`, `runTick`, `stats`, or `dispose`. The caller sends one request at a time and validates replies against the expected tank IDs and action allowlist. Frames are capped at 2 MiB for requests and 64 KiB for replies. A battle is capped at 12 participants and 1,000 tick batches.

## Isolation and limits

- QuickJS limits each tank to 16 MiB of guest heap, a 64 KiB guest stack, and a 100 ms execution budget.
- Docker runs as UID and GID 10001 with a read-only root, no host mounts, no external network, dropped capabilities, no new privileges, and the default seccomp profile. The Node process starts with an empty environment. The runner checks effective Linux controls before accepting scripts.
- The container is capped at 384 MiB without swap, one CPU, and 32 processes or threads. An independent 300-second lifetime timer bounds running containers. The caller enforces request deadlines and force-removes the container on cancellation or failure.
- If the caller dies between container creation and startup, Docker may leave a stopped container. The `tankscript.runner=1` label identifies runner containers for recovery.

For public execution, keep the Docker controller and runner on a separate host or VM without application credentials. A container shares the host kernel. Measure a single battle under the intended host limits before choosing a concurrency budget.
