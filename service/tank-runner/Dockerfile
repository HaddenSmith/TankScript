FROM node:24-bookworm-slim

WORKDIR /runner
COPY service/tank-runner/package.json service/tank-runner/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY service/tank-runner/runner.js service/tank-runner/protocol.js service/tank-runner/isolation.js ./service/tank-runner/
COPY src/game/tank-script/quickjsTankRuntime.js src/game/tank-script/tankScriptRunnerProtocol.js ./src/game/tank-script/

USER 10001:10001
ENTRYPOINT ["/usr/bin/timeout", "--signal=KILL", "300s", "/usr/bin/env", "-i", "/usr/local/bin/node", "/runner/service/tank-runner/runner.js", "--container"]
