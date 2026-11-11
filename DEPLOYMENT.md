# Deploy TankScript on Ubuntu EC2

The production package serves browser-hosted battles. The packaged entry point starts Express in production mode on IPv4 loopback. Caddy serves the HTTPS site and proxies to Express. Docker is optional for this deployment.

## Before deployment

- On your workstation, use Node.js 24 with npm, Bash, OpenSSH, GNU tar, and `sha256sum`. On Windows, Git Bash or WSL can run the script. Verify the server's SSH host key against a trusted record before adding it to `known_hosts`.
- On Ubuntu, use a supported release with Node.js 24, npm, PM2, Caddy, Bash, curl, tar, coreutils, and util-linux for `flock`. The `ubuntu` account must be able to run Node, npm, and PM2 from a non-interactive SSH session. Test that before deployment with `ssh -i "$key" "ubuntu@$host" 'node -v; npm -v; pm2 -v; command -v flock curl tar sha256sum'`. Keep PM2 under the existing unprivileged application account, with one fork-mode process for TankScript.
- Confirm the existing PM2 process uses `$HOME/services/startup/index.js` and `$HOME/services/startup` as its working directory. The example service is `startup`. Use your real process name consistently. The script checks this layout before switching releases. If your PM2 paths differ, stage the archive separately, preserve the current directory and PM2 settings, and plan a maintenance window to adopt the stable paths. Leave the current process running until the new directory, private config, and rollback plan are ready. [PM2 application settings](https://pm2.keymetrics.io/docs/usage/application-declaration/)
- Confirm Caddy proxies the entire site to `127.0.0.1:4000` or your existing IPv4 loopback port and preserves `Host`. Express serves both the site and the API. Keep port 4000 and Caddy's admin interface private. Check the security group and firewall. Use HTTPS for the secure authentication cookie. [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- Verify the existing MongoDB account can connect and create the existing unique indexes, and that you have a recoverable backup. On the server, create the private configuration before deploying. For the first migration, copy the current configuration as the PM2 user. The example uses the existing `{ "userName": "...", "password": "...", "hostname": "..." }` format. A private JSON file with a `uri` field is also supported. Keep the file outside all public roots and avoid printing it.

```bash
service=startup
config="$HOME/services/.$service-config/dbConfig.json"
install -d -m 700 "${config%/*}"
test -e "$config" || install -m 600 "$HOME/services/$service/backend/dbConfig.json" "$config"
stat -c '%a %U %n' "$config"
```

The package links `backend/dbConfig.json` to this private file. `TANKSCRIPT_DB_CONFIG` optionally points to another private file, and `TANKSCRIPT_DB_NAME` defaults to `tankscript`. Omit both for the existing setup unless you already use a different database. Set `TANKSCRIPT_BACKEND_BATTLES=0` or leave it unset in PM2. The deployment build sets `VITE_TANKSCRIPT_BACKEND_BATTLES=0`. If PM2 already has the server flag enabled, clear it during a maintenance window with `TANKSCRIPT_BACKEND_BATTLES=0 pm2 restart startup --update-env`.

For a fresh PM2 registration, use the stable directory after it has been populated and verified in staging. Confirm the port and environment before replacing an existing registration. Set the shutdown grace period when registering the process. Run `pm2 startup` as the app user, follow the generated systemd setup instructions, and run `pm2 save` after verification. [PM2 graceful shutdown](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/) · [PM2 startup](https://pm2.keymetrics.io/docs/usage/startup/)

```bash
pm2 start "$HOME/services/startup/index.js" --name startup --cwd "$HOME/services/startup" \
  --kill-timeout 45000 --wait-ready --listen-timeout 30000 -- 4000
```

### Capacity checks

Run these read-only commands on EC2 during ordinary traffic, and repeat while testing on the intended runner host. Use the EC2 console to confirm the instance type, CPU credit mode, attached role, and metadata settings.

```bash
nproc
lscpu
free -h
swapon --show
vmstat 1 10
df -h "$HOME" /var/lib
df -ih "$HOME" /var/lib
pm2 status
ps -p "$(pm2 pid startup)" -o pid,%cpu,rss,etime,comm
du -sh "$HOME/services/.startup-releases" 2>/dev/null
```

For the website alone, a 1 GiB machine can be workable if the current service is stable, MongoDB is remote, and the local build stays off EC2. Check peak available RAM and swap activity while npm installs production dependencies and PM2 restarts. Allow several GiB of free disk for two or more releases, npm cache, and logs.

For a combined web and Docker pilot, use **2 vCPUs and 2 GiB RAM as a floor to measure** and **2 vCPUs and 4 GiB as the starting target**. Plan for roughly 10 GiB free before adding Docker, or a 20–25 GiB volume with room for Ubuntu, images, the build cache, and retained releases. These are planning estimates. Budget separately for the OS and Caddy, Express and PM2, Docker and its helpers, the runner, and npm or image-build peaks. The 384 MiB no-swap cap applies only to one container. Aim for at least 750 MiB available before starting that container and several hundred MiB still available at peak. Build frontend and runner images off a constrained host if build activity competes with the website.

The repo does not record the current instance type. If it is a 1 GiB micro instance, keep it for the website and use a separate runner host for a pilot. On burstable instances, compare `CPUUtilization`, `CPUCreditBalance`, and, in Unlimited mode, surplus credit metrics. A T3 micro earns 12 credits per hour and a T3 small or medium earns 24. A container using one full vCPU for an hour consumes 60 credits by itself. A short trial with a full credit balance can hide sustained throttling or surplus charges. [EC2 CPU credits and baseline utilization](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html)

Measure peak host and container memory, Express response times, tick latency, runner startup and removal, available disk and inodes, and swap or OOM events. The local Linux Docker benchmark measured 16 ms p95 for two tanks and 558 ms p95 for 12 bullet-heavy Checkmates, compared with the fastest 125 ms setting. The recorded container cgroup peaks were about 36 and 40 MiB for those samples. Measure the host separately and leave room for workloads up to the enforced cap. Begin with two official tanks, one battle, and a one-second tick target. Repeat the benchmark on the intended host before increasing the workload.

## Deployment

Build and inspect an archive without connecting to a server.

```bash
bash deployService.sh -o ./tankscript-release.tar.gz
tar -tzf ./tankscript-release.tar.gz
```

On your workstation, set `key` to your existing SSH key path and `host` to your verified hostname. Use `-m` once to migrate the existing working directory. Omit it on subsequent deployments. Pass `-p` if the PM2 process already listens on a different port.

```bash
bash deployService.sh -k "$key" -h "$host" -s startup -m
```

The script builds locally with locked dependencies, verifies the frontend bundle, and uploads one archive. On EC2 it verifies the checksum, stages the files, links the private config, and installs only backend production dependencies. A per-service lock serializes activation and rollback. The first migration moves the old directory intact and installs a stable symlink. Later deployments replace that symlink atomically. PM2 restarts the existing process and the script verifies its working directory, database readiness, disabled hosting, and the served HTML. A failed restart or health check restores the previous release. Expect a brief PM2 restart window, plus two directory operations on the first migration. Releases are retained so you can choose when to reclaim disk.

The archive contains the Express entry point, shared game modules, public build, and the Docker runner build context. Build the runner from the extracted archive root using `docker build -f backend/tank-runner/Dockerfile -t tankscript-runner:local .` on a trusted runner test host. BuildKit applies the Dockerfile-specific context allowlist and explicit file permissions for the non-root runner. [Dockerfile build reference](https://docs.docker.com/reference/dockerfile/)

## Verify with hosted battles disabled

```bash
pm2 status
pm2 logs startup --lines 50 --nostream
curl -fsS http://127.0.0.1:4000/api/test
curl -fsS http://127.0.0.1:4000/api/health
curl -sS -i -X POST http://127.0.0.1:4000/api/battles
```

Expect `/api/health` to report `express` and `database` as `ready`, `hostedBattles: false`, and `runner: "disabled"`. A failed MongoDB ping returns 503 while `/api/test` still reports liveness. The health response caches the database result for ten seconds and contains no connection details. The battle API returns 503 with `BATTLES_DISABLED`. An attempted production opt-in returns `RUNNER_UNAVAILABLE` until a separate launcher is available.

From your workstation, repeat the health request over HTTPS. Open `/battle` directly, sign in, and run Firefly against Bloodhound. Open the Tank Editor and generate a command in the Debugger. In the browser's Network panel, verify QuickJS and Monaco Worker requests return JavaScript and the fetched `.wasm` file returns `application/wasm`. A missing asset should return 404. Check `/backend/dbConfig.json` over HTTPS for 404. To restart after verification, use `pm2 restart startup` followed by the same health checks.

## Controlled hosted-battle test

**Production enabling is blocked in this release.** The current development controller launches Docker directly. Keep that path on a credential-free test machine, and keep the public Express account outside the Docker group with no Docker socket, daemon API, sudo wrapper, or equivalent administrative access. Direct daemon access can grant control of the host. A production launcher still needs to be implemented and validated. [Docker Engine security](https://docs.docker.com/engine/security/)

Prefer a separate Linux VM or host with no MongoDB, deployment, or AWS credentials. Run a dedicated launcher under a separate identity. Give Express access only to the launcher's authenticated private interface. A same-host design would need a restricted Unix socket with explicit caller authorization and permissions, launcher code and config that Express cannot modify, and independent capacity and cleanup enforcement. Allow only bounded requests to initialize, advance, and dispose of a battle. The launcher selects a fixed runner image by digest and owns all Docker options, names, mounts, environment, timeouts, and container IDs. Keep this interface out of Caddy and off public networks. Verify the web account cannot contact Docker independently. Disable instance metadata on a runner that has no need for it. Where the web host needs metadata, require IMDSv2 and a least-privilege role. [EC2 metadata settings](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-IMDS-existing-instances.html)

For today's controlled test, use a disposable Ubuntu Linux environment with Docker Engine, BuildKit, cgroup v2 with CPU, memory, PID and swap controls, default seccomp, and a disposable MongoDB configuration. Install Docker using the official Ubuntu instructions on that environment. Run these commands as its trusted operator. [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)

The runner uses UID/GID 10001, a read-only root, loopback-only networking, an empty Node environment, no host mounts or Docker socket, dropped capabilities, no new privileges, and seccomp. Docker caps it at one CPU, 384 MiB with zero swap, and 32 processes or threads. QuickJS limits each tank to a 100 ms execution budget, 16 MiB guest heap, and 64 KiB guest stack. The runner checks effective Linux controls before accepting a script. Recheck the daemon profile, image, cgroups, and cleanup on the intended host.

```bash
npm ci
docker build -f backend/tank-runner/Dockerfile -t tankscript-runner:local .
npm run test:backend-runner:docker
TANKSCRIPT_DB_CONFIG=/path/to/private-test-db.json TANKSCRIPT_BACKEND_BATTLES=1 npm run dev:backend
# In another terminal
VITE_TANKSCRIPT_BACKEND_BATTLES=1 npm run dev
```

Sign in on localhost, run Firefly and Bloodhound at one second per tick, then pause, resume and reset. Check the container disappears on reset and on Express shutdown. On the trusted test host, check the daemon and inspect only the exact runner ID you intend to verify. During an active test, `docker stats --no-stream <runner-id>` gives memory and CPU readings.

```bash
docker info --format '{{.CgroupVersion}} {{json .SecurityOptions}}'
docker image inspect --format '{{.Id}}' tankscript-runner:local
docker ps -a --no-trunc --filter label=tankscript.runner=1
docker ps -a --no-trunc --filter label=tankscript.runner=1 --filter status=created
```

The existing recovery sweeps only aged, never-started containers after matching the label, image, UUID-based name, and exact ID. Running containers have a 300-second lifetime limit. A failed confirmed removal blocks new starts in the current controller. Before restarting after that failure, verify the affected container ID and confirm it is gone. The development `runner: "reachable"` health value means Docker and the expected image answered the background check. Use the isolation suite and a real battle to verify the execution controls on the intended host.

## Rollback

From the workstation, restore the recorded previous release.

```bash
bash deployService.sh -k "$key" -h "$host" -s startup -r
```

Use the same `-p` as deployment. The script restarts PM2 and verifies the restored site. The initial legacy release uses its existing `/api/test` and HTML since it predates `/api/health`. If SSH was interrupted, check `readlink "$HOME/services/startup"`, `readlink "$HOME/services/.startup-releases/previous"`, and PM2 logs first. The rollback command also handles an interrupted first migration with a missing active link and an intact previous directory. If the app or working directory differs from the preflight assumptions, preserve both releases and recover using the previously recorded PM2 configuration during a maintenance window. Keep the private database config and MongoDB data in place when rolling back application files.
