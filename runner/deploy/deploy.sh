#!/bin/sh
# Builds the runner here, installs it and its unit on a server, and restarts it.
# Usage: runner/deploy/deploy.sh HOST
set -eu

host=${1:?usage: deploy.sh HOST}
cd "$(dirname "$0")/.."

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o "$dir/mind-graph-runner" .
cp deploy/mind-graph-runner.service "$dir/"

remote=$(ssh "$host" mktemp -d)
scp -q "$dir/mind-graph-runner" "$dir/mind-graph-runner.service" "$host:$remote/"
# -t lets sudo ask for a password.
ssh -t "$host" "
	set -e
	trap 'rm -rf $remote' EXIT
	sudo install -m 755 $remote/mind-graph-runner /usr/local/bin/mind-graph-runner
	sudo install -m 644 $remote/mind-graph-runner.service /etc/systemd/system/mind-graph-runner.service
	sudo systemctl daemon-reload
	sudo systemctl enable mind-graph-runner
	sudo systemctl restart mind-graph-runner
	sleep 3
	curl -fsS http://127.0.0.1:8090/healthz
	sudo journalctl -u mind-graph-runner -n 3 --no-pager -o cat
"
