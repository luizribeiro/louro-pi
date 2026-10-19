{
  description = "A pi-durable IRC bot that can only run louro";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    louro.url = "github:luizribeiro/louro";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      louro,
      git-hooks,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodejs = pkgs.nodejs_24;
        runtimeInputs = [
          louro.packages.${system}.default
          nodejs
          pkgs.bash
          pkgs.coreutils
          pkgs.gnupg
          pkgs.sops
        ];
        nodeModules = pkgs.importNpmLock.buildNodeModules {
          npmRoot = ./.;
          inherit nodejs;
          derivationArgs.npmRebuildFlags = [ "--ignore-scripts" ];
        };
        appSrc = pkgs.lib.fileset.toSource {
          root = ./.;
          fileset = pkgs.lib.fileset.unions [
            ./src
            ./SYSTEM.md
            ./package.json
            ./louro.toml
            ./secrets
            ./louro-pi
          ];
        };
        app = pkgs.runCommand "louro-pi-app" { } ''
          cp -r ${appSrc} $out
          chmod u+w $out
          ln -s ${nodeModules}/node_modules $out/node_modules
        '';
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
            export LOURO_PI_SRC=${app}
            exec bash ${app}/louro-pi "$@"
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
          packages = runtimeInputs ++ [ pkgs.jq ] ++ gitHooks.enabledPackages;
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
