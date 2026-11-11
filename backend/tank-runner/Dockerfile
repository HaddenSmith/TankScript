FROM node:24-bookworm-slim

WORKDIR /runner
COPY --chmod=0644 backend/tank-runner/package.json backend/tank-runner/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# Release staging uses a private umask. Keep the packaged source readable to UID 10001.
COPY --chmod=0644 backend/tank-runner/runner.js backend/tank-runner/protocol.js backend/tank-runner/isolation.js ./backend/tank-runner/
COPY --chmod=0644 shared/game/tank-script/quickjsTankRuntime.js shared/game/tank-script/tankScriptRunnerProtocol.js ./shared/game/tank-script/
RUN chmod 0755 backend backend/tank-runner shared shared/game shared/game/tank-script

USER 10001:10001
ENTRYPOINT ["/usr/bin/timeout", "--signal=KILL", "300s", "/usr/bin/env", "-i", "/usr/local/bin/node", "/runner/backend/tank-runner/runner.js", "--container"]
