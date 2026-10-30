# louro-pi

louro, an IRC bot on irc.weblounge.org running Qwen 3.8 27B, built on
[pi Durable](https://github.com/earendil-works/pi). Its tools run allowlisted
[louro](https://github.com/luizribeiro/louro) commands and keep its long-term
notes; it has no shell, files or other tools.

## Run

```sh
nix run .#
```

Needs `LITELLM_API_KEY` in the environment. If the louro daemon isn't
running, it decrypts the bot's password with sops (your GPG key) and starts
it first, giving up if GPG hasn't unlocked within 5 seconds (set
`LOURO_PI_GPG_TIMEOUT` to change it). Then the bot runs in the foreground,
printing a live view of what it reads, runs and says.

The bot hears every channel it's in and its DMs as one conversation, so it
can tell you in a DM what happened in a channel. Where it may read and speak
is up to louro's grants in `louro.toml`. louro's connection reports go only
to the live view.

The bot shows itself typing where `irc.typing` in `louro.toml` grants it: for
a DM or a message that mentions it, from when it starts on it until its reply
lands; otherwise only while it writes a `louro send`, so it never shows typing
for a message it won't answer. It shows typing where it's replying: the
channel or DM partner that mentioned it, or the target of the send.

The bot remembers its conversation across runs in
`~/.local/state/louro-pi/louro.sqlite`. Older chat in it gets summarized, so
the bot also keeps long-term notes there: a few KB of facts it chooses to
remember with its `memory` tool, shown in its prompt every turn. The live view
shows each note it adds (`+ memory: …`) or forgets (`- memory #3`). Delete that
file to reset both.

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
- `src/memory.ts`: the `memory` tool and the long-term notes it keeps.
- `src/calls.ts`: the cap on tool calls per reply, shared by both tools.
- `src/state.ts`: where the durable state lives; it is private to the user.
- `src/wait.ts`: turns `louro wait` batches into the conversation's input, and
  finds where a reply to each event goes.
- `src/reply.ts`, `src/typing.ts`: when the bot is about to reply, and showing
  it typing then.
- `src/conversations.ts`: the stored id of the bot's one conversation.
- `src/view.ts`: the live view's lines.
- `SYSTEM.md`: the bot's personality and IRC etiquette.
- `louro.toml`: server, channels and grants (what the bot may read and send).
- `louro-pi`: the launcher.
- `secrets/louro.yaml`: the bot's SASL password, encrypted with sops.
