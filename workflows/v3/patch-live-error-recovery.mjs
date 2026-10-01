import fs from 'node:fs';

const workflow = JSON.parse(fs.readFileSync(0, 'utf8'));

function requiredNode(name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Missing node: ${name}`);
  return node;
}

const normalize = requiredNode('Normalize Error Context');
const markQueue = requiredNode('Mark Queue FAILED');
const persistLog = requiredNode('Persist Error Log');

const replacements = [
  [
    "const sendStatus = explicitSendStatus || (isSendFailure ? 'SENDING' : '');",
    "const sendStatus = explicitSendStatus || (isSendFailure ? 'SENDING' : 'UNSENT');",
  ],
  [
    "(isSendFailure ? 'RESEARCHED' : 'FAILED')",
    "(isSendFailure ? 'RESEARCHED' : 'ERROR')",
  ],
];
for (const [before, after] of replacements) {
  if (normalize.parameters.jsCode.includes(before)) {
    normalize.parameters.jsCode = normalize.parameters.jsCode.replace(
      before,
      after,
    );
  } else if (!normalize.parameters.jsCode.includes(after)) {
    throw new Error(`Normalize Error Context contract changed: ${before}`);
  }
}

markQueue.parameters.columns.value.send_status =
  "={{ $json.send_status || 'UNSENT' }}";
for (const node of [markQueue, persistLog]) {
  node.parameters.options ??= {};
  node.parameters.options.cellFormat = 'RAW';
  node.parameters.options.handlingExtraData = 'ignoreIt';
  node.retryOnFail = true;
  node.maxTries = 3;
  node.waitBetweenTries = 5000;
}

const writableSettings = { ...workflow.settings };
delete writableSettings.binaryMode;
delete writableSettings.timeSavedMode;

process.stdout.write(
  `${JSON.stringify(
    {
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections,
      settings: writableSettings,
    },
    null,
    2,
  )}\n`,
);
