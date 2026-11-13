#!/usr/bin/env bash
# Installs dpm 3.7.1 under RUNNER_TEMP and exports DPM_HOME, DPM_SDK_VERSION
# and PATH for the rest of the job.
#
# The tarball is the one nix/dpm.nix fetches. Before bootstrap, the SDK
# manifest is trimmed to the same components as that derivation. After
# bootstrap, script-service.jar is linked into damlc's resources when the
# daml-script component produced it. The install does not outlive the job.

set -euo pipefail

version='3.7.1'
yq_version='v4.47.1'
dest="${RUNNER_TEMP}/dpm"
yq="${RUNNER_TEMP}/yq"

# Integrity: verify artifacts before extraction/execution.
# IMPORTANT: Keep expected_dpm_sha256 in lockstep with nix/dpm.nix's x86_64-linux hash
# for the same URL this script fetches. Bump both together when changing 'version'.
expected_dpm_sha256='e251291ef78dcfe290424cece3a7fafa753268727a679a10c7f0d9fa56e6d5e6'
# yq checksum taken from the published release checksums for v4.47.1 (linux amd64).
expected_yq_sha256='0fb28c6680193c41b364193d0c0fc4a03177aecde51cfc04d506b1517158c2fb'

mkdir -p "${dest}"
curl -fsSL -o "${dest}/dpm.tar.gz" \
  "https://get.digitalasset.com/install/dpm-sdk/dpm-${version}-linux-amd64.tar.gz"
echo "${expected_dpm_sha256}  ${dest}/dpm.tar.gz" | sha256sum -c -
tar --strip-components=1 -C "${dest}" -xzf "${dest}/dpm.tar.gz"
rm "${dest}/dpm.tar.gz"

curl -fsSL -o "${yq}" \
  "https://github.com/mikefarah/yq/releases/download/${yq_version}/yq_linux_amd64"
echo "${expected_yq_sha256}  ${yq}" | sha256sum -c -
chmod +x "${yq}"
"${yq}" --inplace \
  '.spec.components |= with_entries(
    select(   .key == "damlc"
           or .key == "daml-script"
           or .key == "codegen"
           or .key == "canton-open-source"
           or .key == "upgrade-check"
           )
          )' \
  "${dest}/sdk-manifest.yaml"

DPM_HOME="${dest}" "${dest}/bin/dpm" bootstrap "${dest}"

# Component directories use the component version from the manifest, which
# is 3.7.0 for damlc and daml-script inside the 3.7.1 SDK.
script_jar="$(find "${dest}/cache/components/daml-script" -name script-service.jar -print -quit || true)"
resources="$(find "${dest}/cache/components/damlc" -type d -path '*/damlc-dist-dpm/lib/resources' -print -quit || true)"
if [ -n "${script_jar}" ] && [ -n "${resources}" ]; then
  ln -sfn "${script_jar}" "${resources}/script-service.jar"
fi

echo "${dest}/bin" >> "${GITHUB_PATH}"
{
  echo "DPM_HOME=${dest}"
  echo "DPM_SDK_VERSION=${version}"
} >> "${GITHUB_ENV}"
