# ============================================================
# TankScript Website Deployment
# ============================================================
#
# Run these commands from the TankScript project root
# using Git Bash on Windows.
#
# NORMAL DEPLOYMENT:
# ./deployWebsite.sh -k ~/.ssh/Haddens-Web-Server.pem -h haddensmith.com -s startup
#
# ROLLBACK TO PREVIOUS VERSION:
# ./deployWebsite.sh -k ~/.ssh/Haddens-Web-Server.pem -h haddensmith.com -s startup -r
#
# The -r flag restores the previous deployed release.
# It does NOT restore previous database contents.
#
# The initial migration (-m) was completed on Nov 11, 2026.
# Do not use -m for normal deployments.
#
# ============================================================


#!/usr/bin/env bash
set -euo pipefail

usage() {
    printf '%s\n' \
        'bash deployWebsite.sh -o <release.tar.gz>' \
        'bash deployWebsite.sh -k <key> -h <hostname> -s <service> [-p <port>] [-m]' \
        'bash deployWebsite.sh -k <key> -h <hostname> -s <service> [-p <port>] -r'
    exit 1
}

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
key= hostname= service= output= port=4000 action=install migration=no
while getopts ':k:h:s:p:o:mr' flag; do
    case "$flag" in
        k) key=$OPTARG ;;
        h) hostname=$OPTARG ;;
        s) service=$OPTARG ;;
        p) port=$OPTARG ;;
        o) output=$OPTARG ;;
        m) migration=yes ;;
        r) action=rollback ;;
        *) usage ;;
    esac
done
shift "$((OPTIND - 1))"
[[ $# == 0 ]] || usage

if [[ -n $output ]]; then
    [[ -z $key && -z $hostname && -z $service && $action == install && $migration == no ]] || usage
    [[ ! -e $output && ! -L $output ]] || { printf 'The output file already exists.\n' >&2; exit 1; }
else
    [[ -f $key && $hostname =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ && $service =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$ ]] || usage
    [[ $port =~ ^[1-9][0-9]{0,4}$ ]] && ((port <= 65535)) || usage
    target=ubuntu@$hostname
    ssh_options=(-i "$key" -o BatchMode=yes -o StrictHostKeyChecking=yes)
fi

if [[ $action == rollback ]]; then
    [[ $migration == no ]] || usage
    ssh "${ssh_options[@]}" "$target" bash -s -- rollback "$service" "$port" < "$repo/scripts/deploy-release.sh"
    exit
fi

umask 077
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
payload=$work/release
archive=$work/release.tar.gz
mkdir -p "$payload/backend/battles" "$payload/backend/tank-runner" "$payload/shared"

(
    cd "$repo"
    npm ci --no-audit --no-fund
    VITE_TANKSCRIPT_BACKEND_BATTLES=0 npm run build -- --outDir "$payload/public"

    cp backend/package.json backend/package-lock.json "$payload/"
    cp backend/index.js backend/database.js backend/mongoConfig.js "$payload/backend/"
    cp backend/battles/{manager,router}.js "$payload/backend/battles/"
    cp backend/tank-runner/{Dockerfile,Dockerfile.dockerignore,package.json,package-lock.json,client.js,protocol.js,isolation.js,runner.js} "$payload/backend/tank-runner/"
    cp -r shared/game "$payload/shared/"
)

# PM2 continues to start the root entry point in the service directory.
printf '%s\n' "process.env.NODE_ENV = 'production';" "await import('./backend/index.js');" > "$payload/index.js"
test -s "$payload/public/index.html"
for pattern in 'quickjsTankWorker-*.js' 'emscripten-module-*.wasm' 'editor.worker-*.js' 'ts.worker-*.js'; do
    compgen -G "$payload/public/assets/$pattern" >/dev/null
done
unexpected=$(find "$payload/public" ! -type d ! \( -type f \( \
    -name '*.html' -o -name '*.js' -o -name '*.css' -o -name '*.wasm' -o -name '*.ttf' -o -name '*.woff2' -o \
    -name '*.png' -o -name '*.jpg' -o -name '*.webp' -o -name '*.svg' -o -name '*.ico' \) \) -print -quit)
[[ -z $unexpected ]] || { printf 'Unexpected public build file: %s\n' "$unexpected" >&2; exit 1; }
tar -C "$payload" -czf "$archive" .

if [[ -n $output ]]; then
    (set -o noclobber; cat "$archive" > "$output")
    printf 'Production package written to %s\n' "$output"
    exit
fi

digest=$(sha256sum "$archive")
release="$(date -u +%Y%m%d%H%M%S)-$(node -p "require('node:crypto').randomBytes(8).toString('hex')")"
ssh "${ssh_options[@]}" "$target" 'umask 077; mkdir -p "$HOME/services"; test ! -L "$HOME/services"'
scp "${ssh_options[@]}" "$archive" "$target:services/.$service.upload-$release.tar.gz"
ssh "${ssh_options[@]}" "$target" bash -s -- install "$service" "$port" "$release" "${digest%% *}" "$migration" < "$repo/scripts/deploy-release.sh"
