FROM node:24-bookworm-slim

WORKDIR /runner
COPY backend/tank-runner/package.json backend/tank-runner/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY backend/tank-runner/runner.js backend/tank-runner/protocol.js backend/tank-runner/isolation.js ./backend/tank-runner/
COPY shared/game/tank-script/quickjsTankRuntime.js shared/game/tank-script/tankScriptRunnerProtocol.js ./shared/game/tank-script/

USER 10001:10001
ENTRYPOINT ["/usr/bin/timeout", "--signal=KILL", "300s", "/usr/bin/env", "-i", "/usr/local/bin/node", "/runner/backend/tank-runner/runner.js", "--container"]
