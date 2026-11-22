import type { RunProgram, SecretsPort } from '@stu/model';

export interface SecretsOpOptions {
  readonly run: RunProgram;

  // what op needs of the watcher's environment, such as PATH and HOME
  readonly opEnv: Readonly<Record<string, string>>;

  // the 1Password service account token that op reads with; undefined when the watcher has none
  readonly serviceAccountToken: string | undefined;
}

// No reason quotes op's output or the reference, which can name the vault: the reason reaches stu.
export function createSecretsOp(options: SecretsOpOptions): SecretsPort {
  return {
    readSecret: async (reference) => {
      if (options.serviceAccountToken === undefined) {
        return { kind: 'unread', reason: 'OP_SERVICE_ACCOUNT_TOKEN is unset' };
      }

      const result = await options
        .run(['op', 'read', reference], {
          env: { ...options.opEnv, OP_SERVICE_ACCOUNT_TOKEN: options.serviceAccountToken },

          // One read takes 6-7 s, and a run reads its references at once. 10 s ends a hung read
          // well inside the watcher's 30 s check timeout, so its fault names the param, and the
          // kind keeps time for its own requests.
          timeoutMs: 10_000,
        })
        .catch(() => null);

      if (result === null) {
        return { kind: 'unread', reason: 'op could not start' };
      }

      const value = result.stdout.trim();

      if (result.code !== 0 || value === '') {
        return { kind: 'unread', reason: `op read failed (exit ${result.code})` };
      }

      return { kind: 'read', value };
    },
  };
}
