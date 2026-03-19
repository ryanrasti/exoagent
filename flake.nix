{
  description = "Exoagent";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs
            deno
            bubblewrap
            passt
            nftables
            nix
            git
            dtach
          ];

          EXOAGENT_NIX = builtins.toJSON {
            bash = "${pkgs.bashNonInteractive}";
            coreutils = "${pkgs.coreutils}";
            bwrap = "${pkgs.bubblewrap}";
            pasta = "${pkgs.passt}";
            nft = "${pkgs.nftables}";
            nix = "${pkgs.nix}";
            cacert = "${pkgs.cacert}";
            git = "${pkgs.git}";
            gnugrep = "${pkgs.gnugrep}";
            dtach = "${pkgs.dtach}";
          };
        };
      }
    );
}
