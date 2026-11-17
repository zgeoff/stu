# The watcher

The watcher tells stu when something of the owner's breaks, and again when it recovers. stu gets one
message when a fault opens and one when it clears, and never a message when nothing changed. The
watcher remembers what stu has heard in one JSON file, the reported file, so a restart sends nothing
twice. Each message reaches stu through atc as a message from a local program named `stu-watch`.

[The overview](./overview.md) shows where the watcher runs and what it talks to.

## Checks and kinds

A check is one entry in the config: an id, a kind, and the kind's params, such as a host and a port
for `tcp`. Each kind maps its params to the faults it sees now. Each fault has a key that stays the
same from run to run, such as a path or a session id, and one line of text for stu. A kind that
cannot look, such as a `df` that fails, throws.

The engine prefixes each fault key with its check id, so two checks never share a key. A check id
holds no `:`, so the bare id is free for the check's own cannot-run fault: a check that throws or
runs past its timeout opens that fault, and its next good run clears it. A check that throws clears
none of its other faults, because a check that cannot look has not seen them recover. The program
exits when the run ends, which stops a probe still running past its timeout, and the service stops a
run that outlives its own time limit, so one hung probe never holds back the next run.

A check with `everyMin` runs when that many minutes have passed since its last run, less a few
seconds of slack, so a timer that fires a little early still runs it. A run that throws still counts
as a run, so a slow kind keeps its interval while it fails.

The kinds get read-only ports. The session kinds read atc through a port that offers only reads, so
no kind can send stu a message.

## What a fault owes stu

```mermaid
stateDiagram-v2
  [*] --> opening: check sees a new fault
  opening --> open: atc takes the open
  open --> clearing: check runs without it, or the check leaves the config
  clearing --> [*]: atc takes the recovery
```

Each fault in the reported file is in one of three phases. An opening fault owes stu its open
message, an open fault owes nothing, and a clearing fault owes stu its recovery. A send that atc
takes moves the fault on, and a send that fails leaves the fault owing it, so the next run sends it
again.

A run first resends what earlier runs still owe, then decides what changed. A fault that still owes
a send after that resend is left as it is. So a fault whose open stu may not have yet keeps owing
the open, even when it clears: the open may have reached stu with its reply lost, and a recovery for
an open stu never got would confuse it. Once atc takes the open, the recovery follows. A fault that
comes back after its recovery was sent opens again, with a new open time.

Every send key is in the file before its first try, and the run saves the file again after each send
that atc takes. A run killed between a send and its save leaves the send owed, and the next run's
resend settles it, as the next section describes.

## Sending each change once

Every owed send carries an idempotency key, made from the fault key, the kind of send and the time
the fault opened. The engine stores the key in the reported file before the first try. atc runs a
key once and answers a repeat with the first send's message, so a resend of a message that reached
stu adds nothing.

atc refuses to run a key again in two cases, and in both the watcher needs a new key:

- atc answers `outcome_unknown` when it cannot tell whether the first send ran. The notifier asks
  atc for the message whose id the error holds. When atc holds it, the send counts as taken.
- atc answers `idempotency_conflict` when a resend differs from the first send, such as after the
  owner changes the session in the config.

For a send that needs a new key, the engine adds a counter to the old key and saves the file before
it sends again. A lost reply to that send then replays on the next run, and stu still gets one
message.

atc keeps a used key for a fixed retention, which its hello answer gives. A resend after that
retention, such as after the PC slept, reaches stu twice.

## How the notifier reaches atc

The notifier calls atc on the atc daemon's client socket, `atc-daemon.sock`. atc also opens
`atc.sock` in the same folder. Session hooks report on `atc.sock`, and it answers no client call.
The daemon puts both sockets in `$XDG_RUNTIME_DIR` as its own environment sets it, or in
`~/.local/state/atc` when that variable is unset. A systemd user unit can get a different
`$XDG_RUNTIME_DIR` from the daemon's. So the notifier first tries `atc-daemon.sock` under its own
`$XDG_RUNTIME_DIR`, then the socket path that the daemon records in
`~/.local/state/atc/daemon.json`.

## How atc labels the sender

atc labels a message by who sent it. A program outside every atc session, whose hello gives a client
name that does not start with `atc/`, sends as `local`, and atc labels its message with the `from`
it gives. The notifier's hello gives the client name `stu-watch/<version>` and sends with
`from: "stu-watch"`. A run started from a session's shell reaches stu as that session, because atc
identifies the caller from the kernel first. The systemd user service runs outside every session.

The notifier speaks atc's protocol version 14. A daemon on another version refuses the hello with
its own version, and the notifier retries once with that version. A change to the hello or to the
message request still breaks the send, and the owed message waits in the reported file until a fix.

## Limits

- Nothing watches the watcher. A stopped timer is silent.
- A probe from this PC fails when the PC's own network is down, so the tcp and http kinds then
  report faults that are this PC's.
