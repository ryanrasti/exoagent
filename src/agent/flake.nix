{
  description = "ExoAgent Electron app";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.nodejs_22 ];

        # Only the libs Electron links against (from ldd)
        LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
          pkgs.glib           # libglib, libgobject, libgio
          pkgs.nss            # libnss3, libnssutil3, libsmime3
          pkgs.nspr           # libnspr4
          pkgs.dbus           # libdbus-1
          pkgs.atk            # libatk-1.0
          pkgs.at-spi2-atk    # libatk-bridge-2.0
          pkgs.at-spi2-core   # libatspi
          pkgs.cups           # libcups
          pkgs.cairo          # libcairo
          pkgs.gtk3           # libgtk-3
          pkgs.pango          # libpango-1.0
          pkgs.libx11
          pkgs.libxcomposite
          pkgs.libxdamage
          pkgs.libxext
          pkgs.libxfixes
          pkgs.libxrandr
          pkgs.libxcb
          pkgs.libgbm         # libgbm (split from mesa)
          pkgs.libGL          # libEGL, libGLESv2
          pkgs.expat
          pkgs.libxkbcommon
          pkgs.systemdLibs    # libudev
          pkgs.alsa-lib       # libasound
        ];
      };
    };
}
