#!/usr/bin/env bash
# Refresh vendored directories listed in links.csv.
#
# Each row is: REPO,COMMIT_SHA,SOURCE_PATH,DEST_PATH
# SOURCE_PATH is copied to DEST_PATH/<its last path component>, replacing that
# directory if it already exists. A second run updates it in place.

set -euo pipefail

cd "$(dirname "$0")"

LIST_CSV="./links.csv"

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value%$'\r'}"
  printf '%s' "$value"
}

while IFS=',' read -r repo sha srcdir destdir; do
  repo="$(trim "$repo")"
  [[ -z "$repo" || "$repo" == \#* ]] && continue

  sha="$(trim "$sha")"
  srcdir="$(trim "$srcdir")"
  srcdir="${srcdir%/}"
  destdir="$(trim "$destdir")"
  destdir="${destdir%/}"

  name="$(basename "$srcdir")"
  dest="${destdir}/${name}"

  echo "Copying ${srcdir} from ${repo} at ${sha} to ${dest}"

  tmp="$(mktemp -d)"
  git init --quiet "$tmp"
  git -C "$tmp" remote add origin "$repo"
  git -C "$tmp" sparse-checkout set --cone "$srcdir"
  git -C "$tmp" fetch --depth 1 --filter=blob:none origin "$sha"
  git -C "$tmp" checkout --quiet --detach FETCH_HEAD

  rm -rf "$dest"
  mkdir -p "$destdir"
  mv "$tmp/$srcdir" "$dest"
  rm -rf "$tmp"

  echo "Replaced ${dest}"
done < <(grep -v '^[[:space:]]*#' "$LIST_CSV" | grep -v '^[[:space:]]*$')
