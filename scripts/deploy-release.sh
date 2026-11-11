#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() { printf '%s\n' "$*" >&2; exit 1; }
action=${1:-}
service=${2:-}
port=${3:-}
[[ $service =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$ && $port =~ ^[1-9][0-9]{0,4}$ ]] && ((port <= 65535)) || fail 'Invalid service or port.'
services=$HOME/services
current=$services/$service
releases=$services/.$service-releases
previous=$releases/previous
config=$services/.$service-config/dbConfig.json
[[ -d $services && ! -L $services ]] || fail 'Expected a real services directory.'
[[ ! -L $releases ]] || fail 'The release directory must not be a symlink.'
mkdir -p -- "$releases"
exec 9>"$releases/deploy.lock"
flock -n 9 || fail 'A deployment or rollback is already running.'
work=$(mktemp -d "$releases/.stage.XXXXXX")
archive=
trap 'rm -rf -- "$work"; if [[ -n $archive ]]; then rm -f -- "$archive"; fi' EXIT

# Existing PM2 settings must refer to the stable entry point and service directory.
pm2 jlist | node -e '
    const [name, cwd] = process.argv.slice(1);
    let apps;
    try { apps = JSON.parse(require("node:fs").readFileSync(0, "utf8")).filter(app => app.name === name); }
    catch { process.exit(1); }
    const config = apps[0]?.pm2_env;
    if (apps.length !== 1 || config.exec_mode !== "fork_mode" ||
        config.pm_cwd !== cwd || config.pm_exec_path !== cwd + "/index.js") {
        process.exitCode = 1;
    }
' "$service" "$current" || fail 'PM2 must have one fork-mode app using the stable service path. See the deployment guide.'

release_target() {
    local target
    target=$(readlink -- "$1") || return 1
    [[ ${target%/*} == "$releases" && ${target##*/} =~ ^(legacy-)?[0-9]{14}-[a-f0-9]{16}$ &&
        -d $target && ! -L $target ]] || return 1
    printf '%s\n' "$target"
}

set_link() {
    local target=$1 link=$2
    [[ ! -e $link || -L $link ]] || return 1
    ln -s -- "$target" "$work/link" || return 1
    if ! mv -Tf -- "$work/link" "$link"; then
        rm -f -- "$work/link"
        return 1
    fi
}

check_release() {
    local target=$1 pid health
    pid=$(pm2 pid "$service") || return 1
    [[ $pid =~ ^[1-9][0-9]*$ && $(readlink -- "/proc/$pid/cwd") == "$target" ]] || return 1
    if [[ ${target##*/} == legacy-* || $target == "$current" ]]; then
        health=$(curl -fsS --max-time 2 "http://127.0.0.1:$port/api/test") || return 1
        [[ $health == '{"message":"TankScript service is running"}' ]] || return 1
    else
        health=$(curl -fsS --max-time 3 "http://127.0.0.1:$port/api/health") || return 1
        [[ $health == '{"express":"ready","database":"ready","hostedBattles":false,"runner":"disabled"}' ]] || return 1
    fi
    curl -fsS --max-time 3 "http://127.0.0.1:$port/" | cmp -s - "$target/public/index.html"
}

restart_and_check() {
    local target=$1 deadline
    pm2 restart "$service" || return 1
    deadline=$((SECONDS + 45))
    while ((SECONDS < deadline)); do
        if check_release "$target" 2>/dev/null; then return 0; fi
        sleep 1
    done
    return 1
}

if [[ $action == rollback ]]; then
    target=$(release_target "$previous") || fail 'No verified previous release is recorded.'
    if [[ -e $current || -L $current ]]; then
        release_target "$current" >/dev/null || fail 'The active path is outside the release directory.'
    fi
    set_link "$target" "$current" || fail 'Could not restore the previous release link.'
    restart_and_check "$target" || fail 'The previous release did not become healthy. Check PM2 logs.'
    printf 'Restored %s.\n' "${target##*/}"
    exit
fi

release=${4:-}
digest=${5:-}
migration=${6:-}
[[ $action == install && $release =~ ^[0-9]{14}-[a-f0-9]{16}$ && $digest =~ ^[a-f0-9]{64}$ &&
    ( $migration == yes || $migration == no ) ]] || fail 'Invalid release arguments.'
archive=$services/.$service.upload-$release.tar.gz
[[ -f $archive && ! -L $archive ]] || fail 'The uploaded archive is missing.'
actual=$(sha256sum "$archive")
[[ ${actual%% *} == "$digest" ]] || fail 'The uploaded archive checksum does not match.'
[[ -f $config && ! -L $config && -O $config && ! -L ${config%/*} ]] || fail 'Create the private database configuration before deploying.'
case "$(stat -c '%a' -- "$config")" in
    400|600) ;;
    *) fail 'The private database configuration must have mode 400 or 600.' ;;
esac

legacy=no
if [[ -L $current ]]; then
    old=$(release_target "$current") || fail 'The active path is outside the release directory.'
    check_release "$old" || fail 'The active release did not pass preflight.'
elif [[ -d $current && $migration == yes ]]; then
    old=$releases/legacy-$release
    [[ ! -e $old && ! -L $old ]] || fail 'The legacy backup location already exists.'
    check_release "$current" || fail 'The legacy release did not pass preflight.'
    legacy=yes
else
    fail 'Expected an active release. Use -m for the first migration of a working legacy directory.'
fi

target=$releases/$release
[[ ! -e $target && ! -L $target ]] || fail 'The release already exists.'
staged=$work/release
mkdir -- "$staged"
tar -xzf "$archive" -C "$staged" --no-same-owner --no-same-permissions
test -s "$staged/index.js" && test -s "$staged/public/index.html" || fail 'The release package is incomplete.'
ln -s -- "$config" "$staged/backend/dbConfig.json"
(cd "$staged" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
mv -T -- "$staged" "$target"

# Record the rollback target before changing the live service path.
set_link "$old" "$previous" || fail 'Could not record the previous release.'
if [[ $legacy == yes ]]; then mv -T -- "$current" "$old"; fi
if set_link "$target" "$current" && restart_and_check "$target"; then
    printf 'Activated %s. Previous release retained at %s.\n' "$release" "$old"
    exit
fi

printf 'The new release failed its checks. Restoring the previous release.\n' >&2
set_link "$old" "$current" && restart_and_check "$old" || fail 'Automatic rollback did not become healthy. Check PM2 logs and the deployment guide.'
fail 'The previous release is healthy. Deployment failed.'
