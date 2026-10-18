# louro-pi

louro, an IRC bot on irc.weblounge.org running Qwen 3.8 27B, built on
[pi Durable](https://github.com/earendil-works/pi). Its only tool runs
allowlisted [louro](https://github.com/luizribeiro/louro) commands; it has no
shell, files or other tools.

## Run

```sh
nix run .#
```

Needs `LITELLM_API_KEY` in the environment. If the louro daemon isn't
running, it decrypts the bot's password with sops (your GPG key) and starts
it first. Then the bot runs in the foreground, printing a live view of what
it reads, runs and says.

Each channel and each DM partner (by account, else nick) gets its own
conversation, so what someone says in a DM never reaches a channel's
context. The tool enforces it: a channel's conversation may only target that
channel, and a DM's may only send to that person, though it may read channel
history. The live view prefixes each line with its conversation, like
`[#bots]` or `[luiz]`; louro's connection reports go only to the live view.

The bot remembers its conversations across runs in
`~/.local/state/louro-pi/louro.sqlite`. Delete that file to reset them.

## Stop

Ctrl-C or `pkill -f louro-pi-app/src/main.ts` stops the bot. The louro daemon
keeps running; stop it with `nix run .#quit`.

## Change the password

In the dev shell (`direnv allow` or `nix develop`):

```zsh
read -rs 'pw?louro password: '; echo; jq -n --arg p "$pw" '$p' | sops set --value-stdin secrets/louro.yaml '["password"]'; unset pw
```

Then stop the louro daemon so the next run connects with it.

## Check

`nix flake check` runs the type check, tests and Biome. In the dev shell,
`npm run typecheck`, `npm test` and `npm run lint` run them one at a time, and
the pre-commit hook runs all three.

## Files

- `src/main.ts`: the daemon: opens the durable state, runs the louro wait
  loop and prints the live view.
- `src/config.ts`: the model, provider and harness settings.
- `src/tool.ts`, `src/command.ts`, `src/louro.ts`: the `louro` tool, its
  command parser and allowlist, and how louro is run.
- `src/state.ts`: where the durable state lives; it is private to the user.
- `src/wait.ts`: turns `louro wait` batches into input for each conversation.
- `src/conversations.ts`: which conversation an event belongs to, and the
  stored map from each channel or DM partner to its conversation.
- `src/target.ts`: the check that a command stays within its conversation.
- `src/view.ts`: the live view's lines.
- `SYSTEM.md`: the bot's personality and IRC etiquette.
- `louro.toml`: server, channels and grants (what the bot may read and send).
- `louro-pi`: the launcher.
- `secrets/louro.yaml`: the bot's SASL password, encrypted with sops.
