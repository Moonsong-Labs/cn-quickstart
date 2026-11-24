# LocalNet patches

Optional escape hatch for changes that `compose.yaml`, `localnet.env`, and `ADDITIONAL_CONFIG*` variables cannot express.

Every `*.patch` file in this directory is applied in lexicographical order with `git apply` against the fetched Splice LocalNet tree before it is placed into `quickstart/.cache/localnet/<sha>/`. If any patch fails to apply, the fetch aborts without updating the cache.

Keep this directory empty whenever Compose overrides or `ADDITIONAL_CONFIG*` suffice.
