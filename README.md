# louro-pi

louro, an IRC bot on irc.weblounge.org running Qwen 3.8 27B, built on
[pi Durable](https://github.com/earendil-works/pi). Its tools run allowlisted
[louro](https://github.com/luizribeiro/louro) commands, keep its long-term
notes and set its timers; it has no shell, files or other tools.

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
file to reset all of it.

The bot can also wake itself up: its `timer` tool sets one-shot or repeating
timers (every 5 minutes at the most often, up to a year ahead, 20 at a time),
listed in its prompt. Every 10 seconds louro-pi checks for due ones and hands
each to the bot as a `timer` event with the note it left; one that came due
while louro-pi was stopped fires once on the next start. The live view shows
each timer it sets (`+ timer in 45m: …`) or cancels (`- timer #2`), and each
one that fires (`< timer #2`).

Long prompts make the bot slow to answer, so its chat is summarized well
before the model's window fills: in the background from about 64k tokens, and
before its next reply at 80k, keeping the last 8k or so word for word. After
an hour without chat it is summarized once more, so the next reply starts from
a short prompt. The live view shows each summary starting
(`~ compacting (threshold)`, or `(manual)` after a quiet hour) and any that
fails.

Everything the bot would show others goes through `src/filter.ts` first,
as louro's outgoing filter. It blocks anything that looks like a secret: what
[gitleaks](https://github.com/gitleaks/gitleaks) recognizes, private keys,
passwords assigned to a name and long random-looking strings, which also
catches links with long ids, like a Google Doc's. It swaps emails, phone
numbers, card numbers, CPFs, CNPJs, SSNs and IBANs for `[email]` and the like,
except in DMs to the accounts listed after the filter's path in `louro.toml`. The bot is told
what was blocked or swapped. If the filter fails, nothing is sent.

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

`nix flake check` runs the type check, tests and Biome, and tries the filter
the built `louro.toml` points at. In the dev shell,
`npm run typecheck`, `npm test` and `npm run lint` run them one at a time, and
the pre-commit hook runs all three.

## Files

- `src/main.ts`: the daemon: opens the durable state, runs the louro wait
  loop and prints the live view.
- `src/config.ts`: the model, provider and harness settings.
- `src/tool.ts`, `src/command.ts`, `src/louro.ts`: the `louro` tool, its
  command parser and allowlist, and how louro is run.
- `src/memory.ts`: the `memory` tool and the long-term notes it keeps.
- `src/timers.ts`, `src/wake.ts`: the `timer` tool and its timers, and the
  loop that wakes the bot when one is due.
- `src/idle.ts`: the loop that summarizes the chat after a quiet hour.
- `src/tick.ts`: the retry-every-tick loop that the timer and idle loops share.
- `src/calls.ts`: the cap on tool calls per reply, shared by every tool.
- `src/state.ts`: where the durable state lives; it is private to the user.
- `src/wait.ts`: turns `louro wait` batches into the conversation's input, and
  finds where a reply to each event goes.
- `src/reply.ts`, `src/typing.ts`: when the bot is about to reply, and showing
  it typing then.
- `src/filter.ts`: louro's outgoing filter, built from `src/secrets.ts`,
  `src/gitleaks.ts` and `src/pii.ts`, which spot secrets and personal details.
- `src/conversations.ts`: the stored id of the bot's one conversation.
- `src/view.ts`: the live view's lines.
- `SYSTEM.md`: the bot's personality and IRC etiquette.
- `louro.toml`: server, channels, grants (what the bot may read and send) and
  the outgoing filter.
- `louro-pi`: the launcher.
- `secrets/louro.yaml`: the bot's SASL password, encrypted with sops.
