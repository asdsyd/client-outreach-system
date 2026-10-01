import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const run = (file, args = [], input) => {
  const output = execFileSync(process.execPath, [path.join(here, file), ...args], {
    encoding: 'utf8',
    env: process.env,
    input,
  });
  process.stdout.write(output);
};

const payload = execFileSync(
  process.execPath,
  [path.join(here, 'build-sender-v3.mjs')],
  { encoding: 'utf8' },
);

run('test-preflight-send-config.mjs');
run('test-send-gate-email-snapshots.mjs');
run('test-sender-suppression.mjs', ['/dev/stdin'], payload);
run('test-sender-finalization.mjs', ['/dev/stdin'], payload);
run('test-sender-runtime-audit.mjs');
run(
  'verify-sender-release.mjs',
  process.argv.includes('--live') ? ['--live'] : [],
);
if (process.argv.includes('--live')) run('audit-sender-runtime.mjs');

process.stdout.write(
  process.argv.includes('--live')
    ? 'sender release gate passed against live n8n\n'
    : 'sender release gate passed locally\n',
);
