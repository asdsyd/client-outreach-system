import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const refreshCode = fs.readFileSync(
  path.join(here, 'refresh-review-copy-v2.js'),
  'utf8',
);
const q = (value) => JSON.stringify(value);

const source = `import {
  workflow,
  node,
  trigger,
  expr
} from '@n8n/workflow-sdk';

const manualCopyRefresh = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: {
    name: 'Manual Copy Refresh',
    parameters: {},
    position: [0, 0]
  },
  output: [{}]
});

const readReviewQueue = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read Review Queue',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: {
        __rl: true,
        mode: 'list',
        value: 'EXAMPLE_TABLE_1',
        cachedResultName: 'outreach_review_queue_v3'
      },
      returnAll: true
    },
    executeOnce: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    position: [240, 0]
  },
  output: [{
    review_id: 'rvw_example',
    research_status: 'RESEARCHED',
    approval_status: 'PENDING_APPROVAL',
    batch_status: 'UNBATCHED',
    send_status: 'UNSENT'
  }]
});

const prepareSafeCopyRefresh = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Safe Copy Refresh',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: ${q(refreshCode)}
    },
    position: [480, 0]
  },
  output: [{
    review_id: 'rvw_example',
    draft_revision: 2,
    approval_status: 'PENDING_APPROVAL',
    batch_status: 'UNBATCHED',
    send_status: 'UNSENT',
    updated_by: 'n8n:copy-refresh-v2'
  }]
});

const updateReviewRows = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Update Review Rows',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: {
        __rl: true,
        mode: 'list',
        value: 'EXAMPLE_TABLE_1',
        cachedResultName: 'outreach_review_queue_v3'
      },
      matchType: 'allConditions',
      filters: {
        conditions: [{
          keyName: 'review_id',
          condition: 'eq',
          keyValue: expr('{{ $json.review_id }}')
        }]
      },
      columns: {
        mappingMode: 'autoMapInputData',
        value: {},
        matchingColumns: [],
        schema: []
      },
      options: {
        dryRun: true
      }
    },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    position: [720, 0]
  },
  output: [{
    review_id: 'rvw_example',
    draft_revision: 2,
    approval_status: 'PENDING_APPROVAL',
    updated_by: 'n8n:copy-refresh-v2'
  }]
});

export default workflow(
  'nunoon-review-copy-refresh-v2',
  'Nunoon - One-Time Review Copy Refresh v2'
)
  .add(manualCopyRefresh)
  .to(readReviewQueue)
  .to(prepareSafeCopyRefresh)
  .to(updateReviewRows);
`;

fs.writeFileSync(
  path.join(here, 'refresh-review-copy-v2.workflow.js'),
  source,
);
