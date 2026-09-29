#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/tool-versions.env
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$arch" in arm64|aarch64) arch=arm64;; x86_64) arch=amd64;; *) echo "Unsupported architecture" >&2; exit 1;; esac
case "$os" in darwin|linux) ;; *) echo "Requires macOS or Linux" >&2; exit 1;; esac
mkdir -p .tools
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
for tool in supabase sqlc; do
  if [[ "$tool" == supabase ]]; then version=$SUPABASE_VERSION; repo=supabase/cli; else version=$SQLC_VERSION; repo=sqlc-dev/sqlc; fi
  archive="${tool}_${version}_${os}_${arch}.tar.gz"
  curl --fail --location --retry 3 --silent --show-error "https://github.com/$repo/releases/download/v$version/$archive" -o "$stage/$archive"
  tar -xzf "$stage/$archive" -C "$stage" "$tool"
  install -m 755 "$stage/$tool" ".tools/$tool"
done
.tools/supabase --version
.tools/sqlc version
