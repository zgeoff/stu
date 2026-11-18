# fault-messages

Check that a fault, then its recovery, reach an atc session as two messages from the watcher. The
systemd timer runs `bun apps/watch/src/main.ts` once a minute, and each run sends one message for
each fault that opened or recovered. The journey runs that program twice against the run's daemon,
with one tcp check on the run's probe port: first while nothing listens on the port, then while
`run-watch` holds it open.

## Journey

```bash
bun verify use --feature fault-messages
bun verify action run-watch --port closed
bun verify action run-watch --port open
bun verify inbox
```

## End state

All of these must hold:

- Each `run-watch` returns `data.stdout` `stu-watch: sent 1, failed 0`.
- The last two entries of the `data.messages` of `inbox` both have `from` `stu-watch` and `sender`
  `local`.
- The first of the two has a `text` that starts with `FAULT verify-port:127.0.0.1:`, and the second
  has a `text` that starts with `RECOVERED verify-port:127.0.0.1:`, with the same port.
