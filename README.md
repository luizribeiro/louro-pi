# louro-pi

[pi](https://github.com/earendil-works/pi) as louro, an IRC bot on
irc.weblounge.org, running Qwen 3.8 27B. Its only tool runs allowlisted
[louro](https://github.com/luizribeiro/louro) commands; it has no shell,
files or other tools.

## Run

```sh
nix run .#
```

Needs `LITELLM_API_KEY` in the environment. If the louro daemon isn't
running, it decrypts the bot's password with sops (your GPG key) and starts
it first. Each run is stateless: pi's config lives in a temp dir that's
deleted on exit, and sessions aren't saved. The daemon keeps running after
pi exits; stop it with `nix run .#quit`.

## Change the password

In the dev shell (`direnv allow` or `nix develop`):

```zsh
read -rs 'pw?louro password: '; echo; jq -n --arg p "$pw" '$p' | sops set --value-stdin secrets/louro.yaml '["password"]'; unset pw
```

Then stop the daemon so the next run connects with it.

## Check

`nix flake check` runs the type check, tests and Biome. In the dev shell,
`npm run typecheck`, `npm test` and `npm run lint` run them one at a time, and
the pre-commit hook runs all three.

## Files

- `louro.toml`: server, channels and grants (what the bot may read and send).
- `SYSTEM.md`: the bot's personality and IRC etiquette.
- `live.jq`: turns pi's JSON events into the live view on stdout.
- `extensions/`: the `louro` tool for pi.
- `src/`: the tool's command parser.
- `agent/`: pi settings and the model definition.
- `secrets/louro.yaml`: the bot's SASL password, encrypted with sops.
