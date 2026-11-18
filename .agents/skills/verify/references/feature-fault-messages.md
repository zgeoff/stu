# fault-messages

Check that the [watcher](../../../../apps/watch/src/main.ts) sends one FAULT message when a check
fails and one RECOVERED message when it passes again, and that the daemon's `claude` session gets
both. Run `up` and `doctor` first, as [Check a change](../SKILL.md#check-a-change) says, and keep
the `data.endpoints.probePort` that `up` prints. The journey's check probes that port:
`--port closed` makes it fail, and `--port open` makes it pass.

## Journey

```bash
bun verify use --feature fault-messages
bun verify action run-watch --port closed
bun verify action run-watch --port open
bun verify inbox
```

## End state

All of these must hold:

- Each `run-watch` prints `data.stdout` equal to `stu-watch: sent 1, failed 0`.
- The last two entries of the `data.messages` that `inbox` prints come from the watcher: each has
  `from` equal to `stu-watch` and `sender` equal to `local`.
- Of those two entries, the first has a `text` that starts with
  `FAULT verify-port:127.0.0.1:<port>`, and the second has a `text` that starts with
  `RECOVERED verify-port:127.0.0.1:<port>`. `<port>` is the `probePort` from `up`.
