import assert from 'node:assert/strict';
import fs from 'node:fs';

const code = fs.readFileSync(
  new URL('./normalize-website-result.js', import.meta.url),
  'utf8',
);
const execute = new Function(
  '$input',
  '$',
  `return (async () => {${code}})();`,
);

async function run(input, upstream = input) {
  return execute(
    { first: () => ({ json: input }) },
    () => ({ first: () => ({ json: upstream }) }),
  );
}

const noWebsite = {
  contact_key: 'one@example.com::pilot-v1',
  company_name: 'One Clinic',
  website: '',
};
const noWebsiteResult = await run(noWebsite);
assert.equal(noWebsiteResult[0].json.contact_key, noWebsite.contact_key);
assert.equal(noWebsiteResult[0].json.website_text, '');
assert.equal(noWebsiteResult[0].json.website_fetch_error, 'NO_WEBSITE');
assert.deepEqual(noWebsiteResult[0].pairedItem, { item: 0 });

const original = {
  contact_key: 'two@example.com::pilot-v1',
  company_name: 'Two Clinic',
  website: 'https://example.com',
};
const fetchedResult = await run({
  ...original,
  website_fetch_response: {
    body: `<html>
      <head>
        <meta name="description" content="Trusted &amp; local dental care">
        <style>.hidden { display: none; }</style>
        <script>ignoreSecret()</script>
      </head>
      <body><h1>Clinic</h1><p>Gentle&nbsp;care</p></body>
    </html>`,
    statusCode: 200,
  },
});
assert.equal(fetchedResult[0].json.contact_key, original.contact_key);
assert.match(
  fetchedResult[0].json.website_text,
  /^Trusted & local dental care\nClinic\nGentle care$/,
);
assert.doesNotMatch(fetchedResult[0].json.website_text, /ignoreSecret|hidden/);
assert.equal(fetchedResult[0].json.website_fetch_error, '');

const replacedInputResult = await run(
  {
    body: '<html>Replacement response</html>',
    statusCode: 200,
    statusMessage: 'OK',
  },
  original,
);
assert.equal(replacedInputResult[0].json.contact_key, original.contact_key);
assert.equal(
  replacedInputResult[0].json.website_text,
  'Replacement response',
);
assert.equal(replacedInputResult[0].json.website_fetch_error, '');

const plainTextResult = await run({
  ...original,
  website_fetch_response: {
    body: 'Plain   clinic text &amp; details',
    statusCode: 200,
  },
});
assert.equal(
  plainTextResult[0].json.website_text,
  'Plain clinic text & details',
);

const failedResult = await run(
  {
    ...original,
    error: { message: 'request timed out' },
  },
);
assert.equal(failedResult[0].json.website_text, '');
assert.equal(failedResult[0].json.website_fetch_error, 'request timed out');

await assert.rejects(
  run({ website_fetch_response: { body: 'orphaned response' } }),
  /WEBSITE_CONTEXT_MISSING/,
);

process.stdout.write('website normalizer tests passed\n');
