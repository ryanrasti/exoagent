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

          EXOAGENT_NIX_BASH = "${pkgs.bashNonInteractive}";
          EXOAGENT_NIX_COREUTILS = "${pkgs.coreutils}";
          EXOAGENT_NIX_BWRAP = "${pkgs.bubblewrap}";
          EXOAGENT_NIX_PASTA = "${pkgs.passt}";
          EXOAGENT_NIX_NFT = "${pkgs.nftables}";
          EXOAGENT_NIX_NIX = "${pkgs.nix}";
          EXOAGENT_NIX_CACERT = "${pkgs.cacert}";
          EXOAGENT_NIX_GIT = "${pkgs.git}";
          EXOAGENT_NIX_DTACH = "${pkgs.dtach}";
        };
      }
    );
}
