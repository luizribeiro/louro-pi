{
  description = "pi as an IRC bot that can only run louro";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    louro.url = "git+https://github.com/luizribeiro/louro";
    agentix = {
      url = "github:luizribeiro/agentix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      louro,
      agentix,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        runtimeInputs = [
          louro.packages.${system}.default
          agentix.packages.${system}.pi
          pkgs.bash
          pkgs.coreutils
          pkgs.gnupg
          pkgs.jq
          pkgs.sops
        ];
      in
      {
        packages.default = pkgs.writeShellApplication {
          name = "louro-pi";
          inherit runtimeInputs;
          inheritPath = false;
          text = ''
            export LOURO_PI_SRC=${./.}
            exec bash ${./louro-pi} "$@"
          '';
        };

        packages.quit = pkgs.writeShellApplication {
          name = "louro-quit";
          inherit runtimeInputs;
          inheritPath = false;
          text = ''
            exec louro quit
          '';
        };

        devShells.default = pkgs.mkShell { packages = runtimeInputs; };
      }
    );
}
