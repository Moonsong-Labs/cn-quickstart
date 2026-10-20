#!/usr/bin/env bash
# Installs dpm 3.5.2 under RUNNER_TEMP and exports DPM_HOME, DPM_SDK_VERSION
# and PATH for the rest of the job.
#
# The tarball is the one nix/dpm.nix fetches. Before bootstrap, the SDK
# manifest is trimmed to the same components as that derivation. After
# bootstrap, script-service.jar is linked into damlc's resources when the
# daml-script component produced it. The install does not outlive the job.

set -euo pipefail

version='3.5.2'
yq_version='v4.47.1'
dest="${RUNNER_TEMP}/dpm"
yq="${RUNNER_TEMP}/yq"

mkdir -p "${dest}"
curl -fsSL -o "${dest}/dpm.tar.gz" \
  "https://get.digitalasset.com/install/dpm-sdk/dpm-${version}-linux-amd64.tar.gz"
tar --strip-components=1 -C "${dest}" -xzf "${dest}/dpm.tar.gz"
rm "${dest}/dpm.tar.gz"

curl -fsSL -o "${yq}" \
  "https://github.com/mikefarah/yq/releases/download/${yq_version}/yq_linux_amd64"
chmod +x "${yq}"
"${yq}" --inplace \
  '.spec.components |= with_entries(
    select(   .key == "damlc"
           or .key == "daml-script"
           or .key == "codegen-js"
           or .key == "codegen-java"
           or .key == "canton-enterprise"
           or .key == "upgrade-check"
           )
          )' \
  "${dest}/sdk-manifest.yaml"

DPM_HOME="${dest}" "${dest}/bin/dpm" bootstrap "${dest}"

script_jar="${dest}/cache/components/daml-script/${version}/script-service.jar"
resources="${dest}/cache/components/damlc/${version}/damlc-dist-dpm/lib/resources"
if [ -f "${script_jar}" ]; then
  mkdir -p "${resources}"
  ln -sfn "${script_jar}" "${resources}/script-service.jar"
fi

echo "${dest}/bin" >> "${GITHUB_PATH}"
{
  echo "DPM_HOME=${dest}"
  echo "DPM_SDK_VERSION=${version}"
} >> "${GITHUB_ENV}"
