import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  switchCase,
  expr
} from '@n8n/workflow-sdk';

const inbox = trigger({
  type: 'n8n-nodes-base.emailReadImap',
  version: 2.1,
  config: {
    name: 'Zoho Inbox',
    parameters: {
      mailbox: 'INBOX',
      postProcessAction: 'read',
      format: 'resolved',
      dataPropertyAttachmentsPrefixName: 'attachment_',
      options: {
        customEmailConfig: '["UNSEEN"]',
        forceReconnect: 60,
        trackLastMessageId: true
      }
    },
    credentials: { imap: newCredential('Zoho IMAP - outreach@example.com') },
    position: [0, 0]
  },
  output: [{
    from: 'Clinic <clinic@example.com>',
    to: 'outreach@example.com',
    subject: 'Re: assessment',
    textPlain: 'Yes, I am interested.',
    messageId: '<inbound@example.com>',
    headers: {
      'message-id': '<inbound@example.com>',
      'in-reply-to': '<outbound@iawebdev.com>'
    }
  }]
});

const normalize = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize and Classify',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return [{json:{event_id:'fixture',dedupe_key:'fixture',lookup_provider_message_id:'<outbound@iawebdev.com>',lookup_email:'clinic@example.com',event_type:'INTERESTED',created_at:new Date().toISOString()}}];"
    },
    position: [240, 0]
  },
  output: [{
    event_id: 'outreach@example.com::mid:<inbound@example.com>',
    dedupe_key: 'outreach@example.com::mid:<inbound@example.com>',
    lookup_provider_message_id: '<outbound@iawebdev.com>',
    lookup_email: 'clinic@example.com',
    event_type: 'INTERESTED'
  }]
});

const newEventOnly = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'New Event Only',
    parameters: {
      resource: 'row',
      operation: 'rowNotExists',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_4", cachedResultName: "outreach_inbound_events_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "dedupe_key", condition: 'eq', keyValue: expr('{{ $json.dedupe_key }}') }] }
    },
    position: [480, 0]
  },
  output: [{ event_id: 'outreach@example.com::mid:<inbound@example.com>' }]
});

const startAudit = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Start Event Audit',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_4", cachedResultName: "outreach_inbound_events_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "dedupe_key", condition: 'eq', keyValue: expr('{{ $json.dedupe_key }}') }] },
      columns: { mappingMode: 'defineBelow', value: {
  event_id: expr('{{ $json.event_id }}'),
  dedupe_key: expr('{{ $json.dedupe_key }}'),
  mailbox: expr('{{ $json.mailbox }}'),
  folder: expr('{{ $json.folder }}'),
  uid_validity: expr('{{ $json.uid_validity }}'),
  imap_uid: expr('{{ $json.imap_uid }}'),
  message_id: expr('{{ $json.message_id }}'),
  in_reply_to: expr('{{ $json.in_reply_to }}'),
  references_json: expr('{{ $json.references_json }}'),
  from_email: expr('{{ $json.from_email }}'),
  to_email: expr('{{ $json.to_email }}'),
  subject: expr('{{ $json.subject }}'),
  received_at: expr('{{ $json.received_at }}'),
  body_excerpt: expr('{{ $json.body_excerpt }}'),
  body_fingerprint: expr('{{ $json.body_fingerprint }}'),
  headers_json: expr('{{ $json.headers_json }}'),
  event_type: expr('{{ $json.event_type }}'),
  reply_intent: expr('{{ $json.reply_intent }}'),
  classification_method: expr('{{ $json.classification_method }}'),
  classification_confidence: expr('{{ $json.classification_confidence }}'),
  dsn_action: expr('{{ $json.dsn_action }}'),
  dsn_status: expr('{{ $json.dsn_status }}'),
  dsn_diagnostic: expr('{{ $json.dsn_diagnostic }}'),
  bounce_recipient: expr('{{ $json.bounce_recipient }}'),
  processing_status: 'PROCESSING',
  notification_status: 'PENDING',
  execution_id: expr('{{ $execution.id }}'),
  last_error_code: '',
  last_error_message: '',
  created_at: expr('{{ $json.created_at }}'),
  updated_at: expr('{{ $now.toISO() }}')
}, matchingColumns: [] },
      options: {}
    },
    position: [720, 0]
  },
  output: [{ event_id: 'outreach@example.com::mid:<inbound@example.com>' }]
});

const readCandidates = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read Candidate Delivery Items',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_3", cachedResultName: "outreach_batch_items_v3" },
      matchType: 'anyCondition', filters: { conditions: [{ keyName: "provider_message_id", condition: 'eq', keyValue: expr("{{ $('Normalize and Classify').item.json.lookup_provider_message_id }}") }, { keyName: "send_to", condition: 'eq', keyValue: expr("{{ $('Normalize and Classify').item.json.lookup_email }}") }] },
      returnAll: true
    },
    alwaysOutputData: true,
    position: [960, 0]
  },
  output: [{ item_key: 'BATCH::1', batch_id: 'BATCH', provider_message_id: '<outbound@iawebdev.com>' }]
});

const hasCandidates = ifElse({
  version: 2.3,
  config: {
    name: 'Candidates Found?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          leftValue: expr('{{ Boolean($json.item_key) }}'),
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true }
        }]
      },
      options: {}
    },
    position: [1200, 0]
  }
});

const candidatesPresent = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Candidate Rows Present',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: 'return $input.all();' },
    position: [1440, -96]
  },
  output: [{ item_key: 'BATCH::1' }]
});

const noCandidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'No Candidate Rows',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: 'return [{ json: { no_candidates: true } }];' },
    position: [1440, 96]
  },
  output: [{ no_candidates: true }]
});

const readBatches = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read Batch Ledger',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_2", cachedResultName: "outreach_batches_v3" },
      returnAll: true
    },
    alwaysOutputData: true,
    executeOnce: true,
    position: [1680, 0]
  },
  output: [{ batch_id: 'BATCH', send_mode: 'TEST', status: 'COMPLETE' }]
});

const hasBatches = ifElse({
  version: 2.3,
  config: {
    name: 'Batches Found?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          leftValue: expr('{{ Boolean($json.batch_id) }}'),
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true }
        }]
      },
      options: {}
    },
    position: [1920, 0]
  }
});

const correlate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Correlate and Plan',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return [{json:{dedupe_key:'fixture',event_id:'fixture',mutation_route:2,notification_route:0,slack_message:'fixture',processing_status:'IGNORED_TEST',notification_status:'PENDING'}}];"
    },
    position: [2160, 0]
  },
  output: [{
    event_id: 'outreach@example.com::mid:<inbound@example.com>',
    event_type: 'INTERESTED',
    mutation_route: 2,
    notification_route: 0,
    processing_status: 'IGNORED_TEST'
  }]
});

const persistPlan = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Persist Correlation Plan',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_4", cachedResultName: "outreach_inbound_events_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "dedupe_key", condition: 'eq', keyValue: expr("{{ $('Correlate and Plan').item.json.dedupe_key }}") }] },
      columns: { mappingMode: 'defineBelow', value: {
  event_id: expr("{{ $('Correlate and Plan').item.json.event_id }}"),
  dedupe_key: expr("{{ $('Correlate and Plan').item.json.dedupe_key }}"),
  event_type: expr("{{ $('Correlate and Plan').item.json.event_type }}"),
  reply_intent: expr("{{ $('Correlate and Plan').item.json.reply_intent }}"),
  match_method: expr("{{ $('Correlate and Plan').item.json.match_method }}"),
  match_confidence: expr("{{ $('Correlate and Plan').item.json.match_confidence }}"),
  review_id: expr("{{ $('Correlate and Plan').item.json.review_id }}"),
  contact_key: expr("{{ $('Correlate and Plan').item.json.contact_key }}"),
  campaign_version: expr("{{ $('Correlate and Plan').item.json.campaign_version }}"),
  batch_id: expr("{{ $('Correlate and Plan').item.json.batch_id }}"),
  item_key: expr("{{ $('Correlate and Plan').item.json.item_key }}"),
  outbound_provider_message_id: expr("{{ $('Correlate and Plan').item.json.outbound_provider_message_id }}"),
  send_mode: expr("{{ $('Correlate and Plan').item.json.send_mode }}"),
  intended_recipient: expr("{{ $('Correlate and Plan').item.json.intended_recipient }}"),
  actual_send_to: expr("{{ $('Correlate and Plan').item.json.actual_send_to }}"),
  is_test: expr("{{ $('Correlate and Plan').item.json.is_test }}"),
  planned_action: expr("{{ $('Correlate and Plan').item.json.planned_action }}"),
  action_applied: expr("{{ $('Correlate and Plan').item.json.action_applied }}"),
  processing_status: expr("{{ $('Correlate and Plan').item.json.processing_status }}"),
  notification_status: expr("{{ $('Correlate and Plan').item.json.notification_status }}"),
  execution_id: expr('{{ $execution.id }}'),
  updated_at: expr('{{ $now.toISO() }}')
}, matchingColumns: [] },
      options: {}
    },
    position: [2400, 0]
  },
  output: [{ event_id: 'outreach@example.com::mid:<inbound@example.com>' }]
});

const routeMutation = switchCase({
  version: 3.4,
  config: {
    name: 'Route Mutation',
    parameters: {
      mode: 'expression',
      numberOutputs: 3,
      output: expr("{{ $('Correlate and Plan').item.json.mutation_route }}"),
      looseTypeValidation: false
    },
    position: [2640, 0]
  }
});

const readExistingControl = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read Existing Contact Control',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_5", cachedResultName: "outreach_suppressions_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "suppression_key", condition: 'eq', keyValue: expr("{{ 'email:' + $('Correlate and Plan').item.json.control_email }}") }] },
      returnAll: true
    },
    alwaysOutputData: true,
    position: [2880, -384]
  },
  output: [{
    suppression_key: 'email:clinic@example.com',
    active: true,
    control_type: 'SUPPRESS',
    permanent: true
  }]
});

const resolveControl = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Resolve Control Precedence',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return [{json:{suppression_key:'email:clinic@example.com',control_email:'clinic@example.com',effective_control_type:'HOLD',effective_permanent:false,effective_reason_code:'HUMAN_REPLY_REVIEW',effective_reason_detail:'INTERESTED via PROVIDER_MESSAGE_ID',control_created_by:'n8n:inbound-v3',control_created_at:new Date().toISOString(),control_audit_json:'[]'}}];"
    },
    position: [3120, -384]
  },
  output: [{
    suppression_key: 'email:clinic@example.com',
    effective_control_type: 'SUPPRESS'
  }]
});

const upsertControl = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Upsert Contact Control',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_5", cachedResultName: "outreach_suppressions_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "suppression_key", condition: 'eq', keyValue: expr("{{ $('Resolve Control Precedence').item.json.suppression_key }}") }] },
      columns: { mappingMode: 'defineBelow', value: {
        suppression_key: expr("{{ $('Resolve Control Precedence').item.json.suppression_key }}"),
        scope: 'EMAIL',
        normalized_email: expr("{{ $('Resolve Control Precedence').item.json.control_email }}"),
        normalized_domain: expr("{{ $('Resolve Control Precedence').item.json.control_email.split('@')[1] || '' }}"),
        control_type: expr("{{ $('Resolve Control Precedence').item.json.effective_control_type }}"),
        reason_code: expr("{{ $('Resolve Control Precedence').item.json.effective_reason_code }}"),
        reason_detail: expr("{{ $('Resolve Control Precedence').item.json.effective_reason_detail }}"),
        active: true,
        permanent: expr("{{ $('Resolve Control Precedence').item.json.effective_permanent }}"),
        source_event_id: expr("{{ $('Correlate and Plan').item.json.event_id }}"),
        source_review_id: expr("{{ $('Correlate and Plan').item.json.review_id }}"),
        created_by: expr("{{ $('Resolve Control Precedence').item.json.control_created_by }}"),
        created_at: expr("{{ $('Resolve Control Precedence').item.json.control_created_at }}"),
        updated_by: 'n8n:inbound-v3',
        updated_at: expr('{{ $now.toISO() }}'),
        released_by: '',
        released_at: null,
        release_reason: '',
        audit_json: expr("{{ $('Resolve Control Precedence').item.json.control_audit_json }}")
      }, matchingColumns: [] },
      options: {}
    },
    position: [3360, -384]
  },
  output: [{ suppression_key: 'email:clinic@example.com', active: true }]
});

const mirrorControl = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Mirror Control to Queue',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_1", cachedResultName: "outreach_review_queue_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "review_id", condition: 'eq', keyValue: expr("{{ 'CONTROL::' + $('Resolve Control Precedence').item.json.control_email }}") }] },
      columns: { mappingMode: 'defineBelow', value: {
        review_id: expr("{{ 'CONTROL::' + $('Resolve Control Precedence').item.json.control_email }}"),
        contact_key: expr("{{ 'CONTROL::' + $('Resolve Control Precedence').item.json.control_email }}"),
        campaign_version: 'GLOBAL-CONTROL',
        company_name: 'Global contact control',
        email: expr("{{ $('Resolve Control Precedence').item.json.control_email }}"),
        intended_recipient: expr("{{ $('Resolve Control Precedence').item.json.control_email }}"),
        research_status: 'SKIPPED',
        draft_subject: '',
        draft_body: '',
        draft_revision: 0,
        draft_hash: '',
        draft_hash_schema: '',
        approval_status: 'BLOCKED',
        batch_status: 'CANCELLED',
        send_status: 'SUPPRESSED',
        attempt_count: 0,
        suppressed_reason: expr("{{ $('Resolve Control Precedence').item.json.effective_reason_code }}"),
        decision_reason: expr("{{ $('Resolve Control Precedence').item.json.effective_reason_code }}"),
        updated_by: 'n8n:inbound-v3',
        audit_json: expr("{{ JSON.stringify([{ action: 'CONTROL_MIRROR_UPSERTED', event_id: $('Correlate and Plan').item.json.event_id, at: $now.toISO() }]) }}"),
        created_at: expr('{{ $now.toISO() }}'),
        updated_at: expr('{{ $now.toISO() }}')
      }, matchingColumns: [] },
      options: {}
    },
    position: [3600, -384]
  },
  output: [{ review_id: 'CONTROL::clinic@example.com', send_status: 'SUPPRESSED' }]
});

const blockPending = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Block Other Unsent Rows',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_1", cachedResultName: "outreach_review_queue_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "email", condition: 'eq', keyValue: expr("{{ $('Resolve Control Precedence').item.json.control_email }}") }, { keyName: "send_status", condition: 'eq', keyValue: 'UNSENT' }, { keyName: "batch_status", condition: 'eq', keyValue: 'UNBATCHED' }] },
      columns: { mappingMode: 'defineBelow', value: {
        approval_status: 'BLOCKED',
        send_status: 'SUPPRESSED',
        batch_status: 'CANCELLED',
        suppressed_reason: expr("{{ $('Resolve Control Precedence').item.json.effective_reason_code }}"),
        decision_reason: expr("{{ $('Resolve Control Precedence').item.json.effective_reason_code }}"),
        updated_by: 'n8n:inbound-v3',
        updated_at: expr('{{ $now.toISO() }}')
      }, matchingColumns: [] },
      options: {}
    },
    alwaysOutputData: true,
    position: [3840, -384]
  },
  output: [{ review_id: 'future-review', send_status: 'SUPPRESSED' }]
});

const pendingFound = ifElse({
  version: 2.3,
  config: {
    name: 'Pending Rows Found?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          leftValue: expr('{{ Boolean($json.review_id) }}'),
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true }
        }]
      },
      options: {}
    },
    position: [4080, -384]
  }
});

const updateEngagement = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Update Delivered Engagement',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_1", cachedResultName: "outreach_review_queue_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "review_id", condition: 'eq', keyValue: expr("{{ $('Correlate and Plan').item.json.review_id }}") }, { keyName: "send_status", condition: 'eq', keyValue: 'SENT' }] },
      columns: { mappingMode: 'defineBelow', value: {
        engagement_status: expr("{{ $('Correlate and Plan').item.json.engagement_status }}"),
        last_inbound_type: expr("{{ $('Correlate and Plan').item.json.event_type }}"),
        last_inbound_event_id: expr("{{ $('Correlate and Plan').item.json.event_id }}"),
        last_inbound_at: expr("{{ $('Correlate and Plan').item.json.received_at }}"),
        last_inbound_from: expr("{{ $('Correlate and Plan').item.json.from_email }}"),
        last_reply_preview: expr("{{ $('Correlate and Plan').item.json.body_excerpt }}"),
        engagement_updated_at: expr('{{ $now.toISO() }}'),
        engagement_updated_by: 'n8n:inbound-v3',
        updated_at: expr('{{ $now.toISO() }}')
      }, matchingColumns: [] },
      options: {}
    },
    alwaysOutputData: true,
    position: [4320, -144]
  },
  output: [{ review_id: 'review', send_status: 'SENT', engagement_status: 'INTERESTED' }]
});

const projectionFound = ifElse({
  version: 2.3,
  config: {
    name: 'Projection Updated?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          leftValue: expr('{{ Boolean($json.review_id) }}'),
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true }
        }]
      },
      options: {}
    },
    position: [4560, -144]
  }
});

const confirmMutation = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Confirm Mutation Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return [{json:{dedupe_key:'fixture',event_id:'fixture',action_applied:true,processing_status:'APPLIED'}}];"
    },
    position: [4800, -144]
  },
  output: [{
    event_id: 'fixture',
    action_applied: true,
    processing_status: 'APPLIED'
  }]
});

const selectFinalPlan = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Select Final Plan',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return [{json:{dedupe_key:'fixture',event_id:'fixture',mutation_route:2,notification_route:0,action_applied:false,processing_status:'IGNORED_TEST',slack_message:'fixture'}}];"
    },
    position: [5040, 0]
  },
  output: [{
    event_id: 'fixture',
    action_applied: false,
    notification_route: 0
  }]
});

const routeNotification = switchCase({
  version: 3.4,
  config: {
    name: 'Route Notification',
    parameters: {
      mode: 'expression',
      numberOutputs: 2,
      output: expr("{{ $('Correlate and Plan').item.json.notification_route }}"),
      looseTypeValidation: false
    },
    position: [5280, 0]
  }
});

const notifySlack = node({
  type: 'n8n-nodes-base.slack',
  version: 2.5,
  config: {
    name: 'Notify Slack',
    parameters: {
      resource: 'message',
      operation: 'post',
      authentication: 'accessToken',
      select: 'channel',
      channelId: {
        __rl: true,
        mode: 'list',
        value: 'EXAMPLE_SLACK_CHANNEL',
        cachedResultName: 'logs'
      },
      messageType: 'text',
      text: expr("{{ $('Select Final Plan').item.json.slack_message }}"),
      otherOptions: {
        includeLinkToWorkflow: true,
        mrkdwn: true,
        unfurl_links: false,
        unfurl_media: true
      }
    },
    credentials: { slackApi: newCredential('Slack account') },
    onError: 'continueRegularOutput',
    position: [5520, -96]
  },
  output: [{ ok: true, channel: 'EXAMPLE_SLACK_CHANNEL', message_timestamp: '0' }]
});

const markNotification = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Mark Notification Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return [{json:{dedupe_key:'fixture',event_id:'fixture',notification_status:'SENT',processing_status:'IGNORED_TEST'}}];"
    },
    position: [5760, -96]
  },
  output: [{ notification_status: 'SENT', processing_status: 'IGNORED_TEST' }]
});

const markSilent = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Mark Silent Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return [{json:{dedupe_key:'fixture',event_id:'fixture',notification_status:'NOT_REQUIRED',processing_status:'APPLIED'}}];"
    },
    position: [5520, 144]
  },
  output: [{ notification_status: 'NOT_REQUIRED', processing_status: 'APPLIED' }]
});

const finalizeNotified = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Finalize Notified Event',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_4", cachedResultName: "outreach_inbound_events_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "dedupe_key", condition: 'eq', keyValue: expr('{{ $json.dedupe_key }}') }] },
      columns: { mappingMode: 'defineBelow', value: {
  event_id: expr('{{ $json.event_id }}'),
  dedupe_key: expr('{{ $json.dedupe_key }}'),
  event_type: expr('{{ $json.event_type }}'),
  reply_intent: expr('{{ $json.reply_intent }}'),
  match_method: expr('{{ $json.match_method }}'),
  match_confidence: expr('{{ $json.match_confidence }}'),
  review_id: expr('{{ $json.review_id }}'),
  contact_key: expr('{{ $json.contact_key }}'),
  campaign_version: expr('{{ $json.campaign_version }}'),
  batch_id: expr('{{ $json.batch_id }}'),
  item_key: expr('{{ $json.item_key }}'),
  outbound_provider_message_id: expr('{{ $json.outbound_provider_message_id }}'),
  send_mode: expr('{{ $json.send_mode }}'),
  intended_recipient: expr('{{ $json.intended_recipient }}'),
  actual_send_to: expr('{{ $json.actual_send_to }}'),
  is_test: expr('{{ $json.is_test }}'),
  planned_action: expr('{{ $json.planned_action }}'),
  action_applied: expr('{{ $json.action_applied }}'),
  processing_status: expr('{{ $json.processing_status }}'),
  notification_status: expr('{{ $json.notification_status }}'),
  notified_at: expr('{{ $json.notified_at || null }}'),
  execution_id: expr('{{ $execution.id }}'),
  last_error_code: expr('{{ $json.last_error_code || "" }}'),
  last_error_message: expr('{{ $json.last_error_message || "" }}'),
  updated_at: expr('{{ $now.toISO() }}')
}, matchingColumns: [] },
      options: {}
    },
    position: [6000, -96]
  },
  output: [{ event_id: 'outreach@example.com::mid:<inbound@example.com>', processing_status: 'IGNORED_TEST' }]
});

const finalizeSilent = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Finalize Silent Event',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_4", cachedResultName: "outreach_inbound_events_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "dedupe_key", condition: 'eq', keyValue: expr('{{ $json.dedupe_key }}') }] },
      columns: { mappingMode: 'defineBelow', value: {
  event_id: expr('{{ $json.event_id }}'),
  dedupe_key: expr('{{ $json.dedupe_key }}'),
  event_type: expr('{{ $json.event_type }}'),
  reply_intent: expr('{{ $json.reply_intent }}'),
  match_method: expr('{{ $json.match_method }}'),
  match_confidence: expr('{{ $json.match_confidence }}'),
  review_id: expr('{{ $json.review_id }}'),
  contact_key: expr('{{ $json.contact_key }}'),
  campaign_version: expr('{{ $json.campaign_version }}'),
  batch_id: expr('{{ $json.batch_id }}'),
  item_key: expr('{{ $json.item_key }}'),
  outbound_provider_message_id: expr('{{ $json.outbound_provider_message_id }}'),
  send_mode: expr('{{ $json.send_mode }}'),
  intended_recipient: expr('{{ $json.intended_recipient }}'),
  actual_send_to: expr('{{ $json.actual_send_to }}'),
  is_test: expr('{{ $json.is_test }}'),
  planned_action: expr('{{ $json.planned_action }}'),
  action_applied: expr('{{ $json.action_applied }}'),
  processing_status: expr('{{ $json.processing_status }}'),
  notification_status: expr('{{ $json.notification_status }}'),
  notified_at: expr('{{ $json.notified_at || null }}'),
  execution_id: expr('{{ $execution.id }}'),
  last_error_code: expr('{{ $json.last_error_code || "" }}'),
  last_error_message: expr('{{ $json.last_error_message || "" }}'),
  updated_at: expr('{{ $now.toISO() }}')
}, matchingColumns: [] },
      options: {}
    },
    position: [5760, 144]
  },
  output: [{ event_id: 'outreach@example.com::mid:<inbound@example.com>', processing_status: 'APPLIED' }]
});

const activationNote = sticky(
  '## LIVE enforcement\nZoho IMAP is connected and the real TEST reply passed. `shadowMode=false` is enabled for exact, authoritative LIVE matches only.\n\nTEST batches, identity mismatches, ambiguous matches, and unsent items never mutate production state. Monitor every pilot execution; downstream write failures require manual reconciliation.',
  [inbox, normalize, newEventOnly, startAudit],
  { color: 5 }
);

const candidateFlow = hasCandidates
  .onTrue(candidatesPresent.to(readBatches))
  .onFalse(noCandidates.to(readBatches));
const batchFlow = hasBatches
  .onTrue(correlate)
  .onFalse(correlate);
const notificationFlow = routeNotification
  .onCase(0, notifySlack.to(markNotification).to(finalizeNotified))
  .onCase(1, markSilent.to(finalizeSilent));
const finalPlanFlow = selectFinalPlan.to(notificationFlow);
const confirmedMutationFlow = confirmMutation.to(finalPlanFlow);
const projectionFlow = updateEngagement.to(
  projectionFound
    .onTrue(confirmedMutationFlow)
    .onFalse(confirmedMutationFlow)
);
const controlFlow = readExistingControl
  .to(resolveControl)
  .to(upsertControl)
  .to(mirrorControl)
  .to(blockPending)
  .to(
    pendingFound
      .onTrue(projectionFlow)
      .onFalse(projectionFlow)
  );
const mutationFlow = routeMutation
  .onCase(0, controlFlow)
  .onCase(1, projectionFlow)
  .onCase(2, finalPlanFlow);

export default workflow('nunoon-inbound-v3', 'Nunoon - Inbound Reply & Bounce Guard v3')
  .add(inbox)
  .to(normalize)
  .to(newEventOnly)
  .to(startAudit)
  .to(readCandidates)
  .to(candidateFlow)
  .add(readBatches)
  .to(batchFlow)
  .add(correlate)
  .to(persistPlan)
  .to(mutationFlow)
  .add(activationNote);
