import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const normalizerCode = fs.readFileSync(
  path.join(here, 'normalize-website-result.js'),
  'utf8',
);
const workflow = JSON.parse(fs.readFileSync(0, 'utf8'));

if (workflow.active) throw new Error('Refusing to patch an active workflow');

const normalizer = workflow.nodes.find(
  (node) => node.name === 'Normalize Website Result',
);
if (!normalizer || normalizer.type !== 'n8n-nodes-base.code') {
  throw new Error('Normalize Website Result Code node is missing');
}
if (!normalizer.parameters?.jsCode?.includes("$('Loop Clinics').item.json")) {
  throw new Error('Normalizer contract changed or is already hardened');
}

normalizer.parameters.jsCode = normalizerCode;

const writableSettings = { ...workflow.settings };
delete writableSettings.binaryMode;
delete writableSettings.timeSavedMode;

process.stdout.write(
  `${JSON.stringify(
    {
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections,
      settings: {
        ...writableSettings,
        executionOrder: 'v1',
      },
    },
    null,
    2,
  )}\n`,
);
