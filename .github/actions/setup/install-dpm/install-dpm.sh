#!/usr/bin/env bash
# Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
# SPDX-License-Identifier: 0BSD

# Installs dpm 3.7.1 under RUNNER_TEMP and exports DPM_HOME, DPM_SDK_VERSION
# and PATH for the rest of the job.
#
# Follows the same steps as the standard installer
# (https://get.digitalasset.com/install/install.sh): download the SDK
# tarball, extract it, and run `dpm bootstrap`. Also checks the tarball
# SHA-256 before extraction. The install does not outlive the job.

set -euo pipefail

# SDK release this job installs. The Daml packages pin the same sdk-version.
version='3.7.1'

# Where bootstrap installs the SDK. Removed with the runner workspace.
dest="${RUNNER_TEMP}/dpm"

# Integrity: verify the tarball before extraction.
# IMPORTANT: Keep expected_dpm_sha256 in lockstep with nix/dpm.nix's x86_64-linux hash
# for the same URL this script fetches. Bump both together when changing 'version'.
expected_dpm_sha256='e251291ef78dcfe290424cece3a7fafa753268727a679a10c7f0d9fa56e6d5e6'

# Scratch directory for the download and the extracted SDK. Removed after bootstrap.
work="$(mktemp -d "${RUNNER_TEMP}/dpm-install.XXXXXX")"

# SDK archive. Same file the standard installer downloads for linux amd64.
tarball="${work}/dpm-${version}-linux-amd64.tar.gz"

# Unpacked SDK that bootstrap reads. Not the install location.
extracted="${work}/extracted"

curl -fsSL -o "${tarball}" \
  "https://get.digitalasset.com/install/dpm-sdk/dpm-${version}-linux-amd64.tar.gz"
echo "${expected_dpm_sha256}  ${tarball}" | sha256sum -c -

mkdir -p "${extracted}"
tar --strip-components=1 -C "${extracted}" -xzf "${tarball}"

DPM_HOME="${dest}" "${extracted}/bin/dpm" bootstrap "${extracted}"

# Bootstrap has unpacked the components. The OCI layout is about 1.3 GB and later commands do not read it.
rm -rf "${dest}/cache/oci-layout"

rm -rf "${work}"

echo "${dest}/bin" >> "${GITHUB_PATH}"
{
  echo "DPM_HOME=${dest}"
  echo "DPM_SDK_VERSION=${version}"
} >> "${GITHUB_ENV}"
