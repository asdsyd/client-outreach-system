import fs from 'node:fs';
import { hardenResearchWorkflow } from './harden-research-v3.mjs';

const workflow = JSON.parse(fs.readFileSync(0, 'utf8'));
if (workflow.active) throw new Error('Refusing to patch an active workflow');

hardenResearchWorkflow(workflow);

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
