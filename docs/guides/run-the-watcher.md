# Run the watcher

Set up the watcher on your PC: write its config, give it a 1Password token, install its systemd user
units, and check one run. The watcher then runs once a minute and sends stu a message about each
fault it finds. You need Bun at `~/.bun/bin/bun`, a running atc daemon, the atc id of stu's session,
`op`, and a 1Password service account that can read the vaults that hold the tokens.

## Write the config

1. Copy the example config to the name git ignores:

   ```bash
   cp apps/watch/stu-watch.config.example.json apps/watch/stu-watch.config.json
   ```

2. Set `notify.session` to the atc id of stu's session. The
   [config schema](../../libs/model/src/watch-config-schema.ts) defines `notify`, `statePath` and
   the other top-level keys.
3. Edit `checks`. Each check gives a kind and its params. The kinds are `memory`, `disk`, `tcp`,
   `http`, `session-dead`, `session-stuck`, `alerts-prometheus`, `alerts-axiom` and
   `quota-anthropic`. `session-dead` takes no params. Each other kind lists its params in the schema
   near the top of its `make-*-kind.ts` file in `adapters/`.
4. For `alerts-prometheus`, set `grafanaURL`, the uid of Grafana's Prometheus datasource, and the
   `op://` reference of a Grafana Viewer token.
5. For `alerts-axiom`, set the `op://` reference of an Axiom token that can read the monitors and
   their datasets.
6. For `quota-anthropic`, set the `op://` reference of each slot's token.

Write each token as an `op://<vault_id>/<item_id>/<field>` reference, with the vault and item ids:
1Password counts a lookup by name as three requests. The watcher reads each reference before the
check runs. Any string param can be a reference.

The watcher reads a relative `statePath` from the config file's folder. git ignores
`stu-watch.config.json` and `stu-watch.reported.json` wherever they are, because they hold private
names.

## Give the watcher the service account token

The watcher reads the references with `op`, which needs a 1Password service account token. The
service loads the token from `~/.config/stu-watch/env`.

1. Create the env file, readable only by you:

   ```bash
   mkdir -p ~/.config/stu-watch && install -m 600 /dev/null ~/.config/stu-watch/env
   ```

2. Open `~/.config/stu-watch/env` in an editor, and add this line, with the token in place of
   `<service_account_token>`:

   ```text
   OP_SERVICE_ACCOUNT_TOKEN=<service_account_token>
   ```

Without the file, the service still runs, and each check that holds a reference opens its cannot-run
fault.

## Move a config from before the notify block

A config with a top-level `atc` block fails to load, and a check with `opServiceAccountToken` or
`tokenRef` opens its cannot-run fault. To move such a config:

1. Replace `"atc": { "session": "<session_id>" }` with
   `"notify": { "kind": "atc", "session": "<session_id>" }`.
2. Move the value of `opServiceAccountToken` in the `quota-anthropic` check to the env file, as
   [Give the watcher the service account token](#give-the-watcher-the-service-account-token) says.
   Then delete `opServiceAccountToken` from the check.
3. Rename each slot's `tokenRef` to `token`, and keep its `op://` reference.
4. Store each raw `token` of `alerts-prometheus` and `alerts-axiom` in 1Password, and replace it
   with the `op://` reference of the stored item, with the vault and item ids.
5. Start one run, as step 2 of [Install the timer](#install-the-timer) says.

   Expect: `ExecMainStatus=0`, and stu gets no new message.

## Install the timer

The service file runs the watcher from `~/stu`. When your clone is elsewhere, set `WorkingDirectory`
in a drop-in with `systemctl --user edit stu-watch.service` after step 1. The watcher runs `op` from
the service's `PATH`. When `op` is in another folder, set `Environment=PATH=` in the same drop-in.

1. Link the units from the repo root:

   ```bash
   systemctl --user link "$PWD/apps/watch/systemd/stu-watch.service" "$PWD/apps/watch/systemd/stu-watch.timer"
   ```

2. Start one run:

   ```bash
   systemctl --user start stu-watch.service
   ```

3. Check the run's exit code:

   ```bash
   systemctl --user show -p ExecMainStatus stu-watch.service
   ```

   Expect: `ExecMainStatus=0`. A `1` means the run failed: a send that the next run tries again, or
   a config or state file it cannot read. `journalctl --user -u stu-watch.service` shows the reason
   the run printed, such as `atc send failed: no atc daemon answers at <socket path>`. In that case,
   start the atc daemon and repeat step 2.

4. Start the timer:

   ```bash
   systemctl --user enable --now stu-watch.timer
   ```

To try a fault, add a `tcp` check aimed at a port where nothing listens, and start one run. stu gets
one `FAULT` message from `stu-watch`, and a second run sends nothing.
