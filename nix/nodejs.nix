# From https://discourse.nixos.org/t/managing-multiple-versions-of-node-js-with-nix/5425
{ pkgs ? import <nixpkgs> {}, version, sha256 }:
  let
    inherit (pkgs) stdenv autoPatchelfHook platforms fetchurl;
    inherit (stdenv) mkDerivation;
    lib = import <nixpkgs/lib>;
  in mkDerivation {
    inherit version;

    name = "nodejs-${version}";

    src = fetchurl {
      url = "https://nodejs.org/dist/v${version}/node-v${version}-linux-x64.tar.xz";
      inherit sha256;
    };

    # QUESTION: put glib and autoPatchelfHook in nativeBuildInputs or buildInputs?
    nativeBuildInputs = with pkgs; [autoPatchelfHook];
    buildInputs = with pkgs; [glib];

    installPhase = ''
      echo "joe is installing nodejs"
      mkdir -p $out
      cp -R ./ $out/
    '';

    meta = {
      description = "Event-driven I/O framework for the V8 JavaScript engine";
      homepage = https://nodejs.org;
      license = lib.licenses.mit;
      platforms = lib.platforms.linux;
    };
}
