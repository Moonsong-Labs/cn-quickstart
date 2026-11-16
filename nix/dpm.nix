{ pkgs ? import <nixpkgs> {} }:

let
  dpmVersion = "3.7.1";
  system = pkgs.stdenv.hostPlatform.system;
  os = if pkgs.stdenv.isDarwin then "darwin" else "linux";
  arch = if pkgs.stdenv.isAarch64 then "arm64" else "amd64";

  dpmHashes = {
    "x86_64-linux" = "sha256:1rnmwrbgmnghqw89lrvsf9l34xgszaky7v2c8a8f5kwdywg2jlg2";
    "aarch64-linux" = "sha256:1rhzyxxdn97m84kbzivfsm48ycj3db55ifjhfna0ll5b7mg35h05";
    "aarch64-darwin" = "sha256:0bi6a6mhl5m879r1y0vlyw40f9bsxx0c7ibj6znl1x0gkdhv7n1x";
  };
  dpmHash = dpmHashes.${system} or (throw "Unsupported system: ${system}");
in
pkgs.stdenv.mkDerivation {
  pname = "dpm";
  version = dpmVersion;

  src = builtins.fetchurl {
    name = "dpm-sdk-${dpmVersion}.tar.gz";
    url = "https://get.digitalasset.com/install/dpm-sdk/dpm-${dpmVersion}-${os}-${arch}.tar.gz";
    sha256 = dpmHash;
  };
  nativeBuildInputs = [ pkgs.yq-go ];
  dontUnpack = true;
  installPhase = ''
    mkdir -p $out
    tar --strip-components=1 -C $out -xzf $src
    chmod -R u+w $out
    # We need just these components from the SDK, to save space
    yq --inplace \
      '.spec.components |= with_entries(
        select(   .key == "damlc"
               or .key == "daml-script"
               or .key == "codegen"
               or .key == "canton-open-source"
               or .key == "upgrade-check"
               )
              )' \
      $out/sdk-manifest.yaml
    DPM_HOME=$out $out/bin/dpm bootstrap $out

    # damlc ide loads script-service.jar from damlc-dist-dpm/resources, but dpm
    # installs it in the daml-script component. Those components are 3.7.0
    # inside the 3.7.1 SDK, so the paths are discovered on disk. Missing
    # either path aborts the install.
    script_jar=$(find $out/cache/components/daml-script -name script-service.jar -print -quit)
    resources=$(find $out/cache/components/damlc -type d -path '*/damlc-dist-dpm/resources' -print -quit)
    if [ -z "$script_jar" ] || [ -z "$resources" ]; then
      echo "damlc ide needs script-service.jar linked into damlc's resources directory." >&2
      echo "script-service.jar: ''${script_jar:-missing}" >&2
      echo "damlc resources: ''${resources:-missing}" >&2
      exit 1
    fi
    ln -s "$script_jar" "$resources/script-service.jar"

    rm -rf $out/oci-registry
    rm -rf $out/cache/oci-layout/*

    mkdir -p $out/nix-support
    echo export DPM_HOME=$out > $out/nix-support/setup-hook
    echo export DPM_SDK_VERSION=${dpmVersion} >> $out/nix-support/setup-hook
  '';
}
