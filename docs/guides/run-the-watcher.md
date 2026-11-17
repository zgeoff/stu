# Run the watcher

Set up the watcher on your PC: write its config, install its systemd user units, and check one run.
The watcher then runs once a minute and sends stu a message about each fault it finds. You need Bun
at `~/.bun/bin/bun`, a running atc daemon, and the atc id of stu's session.

## Write the config

1. Copy the example config to the name git ignores:

   ```bash
   cp apps/watch/stu-watch.config.example.json apps/watch/stu-watch.config.json
   ```

2. Set `atc.session` to the atc id of stu's session.
3. Edit `checks`. Each check gives a kind and its params. The kinds are `memory`, `disk`, `tcp`,
   `http`, `session-dead` and `session-stuck`, and the schema at the top of each kind's file in
   `adapters/` lists its params.

The watcher reads a relative `statePath` from the config file's folder. git ignores
`stu-watch.config.json` and `stu-watch.reported.json` wherever they are, because they hold private
names.

## Install the timer

The service file runs the watcher from `~/stu`. When your clone is elsewhere, set `WorkingDirectory`
in a drop-in with `systemctl --user edit stu-watch.service` after step 1.

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

   Expect: `ExecMainStatus=0`. A `1` means a send failed, and the next run sends it again.
   `journalctl --user -u stu-watch.service` shows what the run printed.

4. Start the timer:

   ```bash
   systemctl --user enable --now stu-watch.timer
   ```

To try a fault, add a `tcp` check aimed at a port where nothing listens, and start one run. stu gets
one `FAULT` message from `stu-watch`, and a second run sends nothing.
