{
  description = "pi as an IRC bot that can only run louro";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    louro.url = "git+https://github.com/luizribeiro/louro";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
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
      git-hooks,
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
        nodejs = pkgs.nodejs_24;
        nodeModules = pkgs.importNpmLock.buildNodeModules {
          npmRoot = ./.;
          inherit nodejs;
          derivationArgs.npmRebuildFlags = [ "--ignore-scripts" ];
        };
        npmScripts = [
          "typecheck"
          "test"
          "lint"
        ];
        npmCheck =
          script:
          pkgs.stdenv.mkDerivation {
            name = "louro-pi-${script}";
            src = ./.;
            nativeBuildInputs = [
              nodejs
              pkgs.importNpmLock.linkNodeModulesHook
            ];
            npmDeps = nodeModules;
            buildPhase = "npm run ${script}";
            installPhase = "touch $out";
          };
        npmHook = script: {
          enable = true;
          entry = "${
            pkgs.writeShellApplication {
              name = "${script}-hook";
              runtimeInputs = [ nodejs ];
              text = "npm run ${script}";
            }
          }/bin/${script}-hook";
          pass_filenames = false;
        };
        forEachScript = f: pkgs.lib.genAttrs npmScripts f;
        gitHooks = git-hooks.lib.${system}.run {
          src = ./.;
          package = pkgs.prek;
          hooks = forEachScript npmHook;
        };
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

        checks = forEachScript npmCheck;

        devShells.default = pkgs.mkShell {
          packages = runtimeInputs ++ [ nodejs ] ++ gitHooks.enabledPackages;
          npmDeps = nodeModules;
          shellHook = ''
            ${gitHooks.shellHook}
            linkNodeModulesHook
          '';
          nativeBuildInputs = [ pkgs.importNpmLock.linkNodeModulesHook ];
        };
      }
    );
}
