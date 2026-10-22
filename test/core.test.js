import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { GoogleGenAI } from '@google/genai';
import { analyze, inspectVideos, processing, seconds, createContext, waitForFile,
  waitForInteraction, withHistory, validateOptions, outputText, REQUEST_LIMIT } from '../src/core.js';

const done = { id: 'interaction-1', status: 'completed', steps: [
  { type: 'model_output', content: [{ type: 'text', text: 'A useful summary.' }] },
] };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-video-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'tiny.mp4');
  await writeFile(file, Buffer.from([0, 1, 2, 3]));
  return file;
}
function fake(overrides = {}) {
  const calls = [];
  const ready = { name: 'files/test', state: 'ACTIVE', uri: 'https://generativelanguage.googleapis.com/v1beta/files/test', mimeType: 'video/mp4' };
  return { calls, files: {
    upload: async arg => { calls.push(['upload', arg]); return ready; },
    get: async arg => { calls.push(['get', arg]); return ready; },
    delete: async arg => { calls.push(['delete', arg]); },
    ...overrides.files,
  }, interactions: {
    create: async arg => { calls.push(['create', arg]); return done; },
    get: async id => { calls.push(['interactionGet', id]); return done; },
    ...overrides.interactions,
  } };
}
const ctx = () => createContext({}, { sleep: async () => {} });

test('timestamps and static options use SDK duration strings', () => {
  assert.equal(seconds('1:02:03.5'), 3723.5);
  assert.deepEqual(processing({ start: '20:00', end: 1500, fps: '0.5' }),
    { type: 'static', start_offset: '1200s', end_offset: '1500s', fps: 0.5 });
  for (const input of [{ processing: 'agentic', fps: 1 }, { start: 2, end: 2 }, { fps: 0 }, { start: '01:61' }, { start: -1 }]) assert.throws(() => processing(input));
});

test('validates option combinations and history shape', () => {
  for (const options of [{ noStore: true, background: true }, { noStore: true, previous: 'x' },
    { stream: true, background: true }, { cleanup: true, noWait: true }, { noWait: true },
    { history: [], previous: 'x' }]) assert.throws(() => validateOptions(options));
  assert.throws(() => withHistory({}, []));
  assert.deepEqual(withHistory([], [{ type: 'text', text: 'hi' }]), [{ type: 'user_input', content: [{ type: 'text', text: 'hi' }] }]);
});

test('uploads local files, sends video before prompt, and cleans up', async t => {
  const file = await fixture(t);
  const client = fake();
  const videos = await inspectVideos([{ source: file, transport: 'upload', start: 5, end: 10, resolution: 'high' }]);
  const result = await analyze(client, videos, 'Describe at 00:06', { cleanup: true }, ctx());
  assert.equal(result.text, 'A useful summary.');
  assert.deepEqual(client.calls.map(x => x[0]), ['upload', 'create', 'delete']);
  assert.deepEqual(client.calls[1][1].input[0].processing, { type: 'static', start_offset: '5s', end_offset: '10s' });
  assert.equal(client.calls[1][1].input[0].resolution, 'high');
  assert.equal(client.calls[1][1].input[1].text, 'Describe at 00:06');
});

test('inline, auto, existing files and mixed YouTube processing', async t => {
  const file = await fixture(t);
  const client = fake();
  const videos = await inspectVideos([{ source: file, transport: 'inline' }, { source: file },
    { source: 'files/test', processing: 'agentic' }, { source: 'https://youtu.be/test', processing: 'static' }]);
  await analyze(client, videos, 'Compare', {}, ctx());
  assert.deepEqual(client.calls.map(x => x[0]), ['get', 'create']);
  const request = client.calls.at(-1)[1];
  assert.equal(request.input[0].data, 'AAECAw==');
  assert.equal(request.input[1].data, 'AAECAw==');
  assert.equal(request.input[2].processing, 'agentic');
  assert.equal(request.input[3].uri, 'https://youtu.be/test');
});

test('dry-run has no client and omits binary payloads', async t => {
  const file = await fixture(t);
  const videos = await inspectVideos([{ source: file, transport: 'inline' }, { source: 'files/test' }, { source: file, transport: 'upload' }]);
  const { request } = await analyze(null, videos, 'Summary', { dryRun: true }, ctx());
  assert.match(request.input[0].data, /base64: 4 bytes/);
  assert.match(request.input[1].uri, /existing/);
  assert.match(request.input[2].uri, /upload/);
});

test('aggregate inline size is limited and auto falls back to upload', async t => {
  const file = await fixture(t);
  await truncate(file, 8_000_000);
  const specs = [{ source: file, transport: 'inline' }, { source: file, transport: 'inline' }];
  await assert.rejects(analyze(null, await inspectVideos(specs), 'x', { dryRun: true }, ctx()), /20 MB/);
  delete specs[1].transport;
  const { request } = await analyze(null, await inspectVideos(specs), 'x', { dryRun: true }, ctx());
  assert.match(request.input[1].uri, /upload/);
  assert.ok(REQUEST_LIMIT > 0);
});

test('invalid files, URLs, media options and excessive inputs fail', async t => {
  const file = await fixture(t);
  for (const specs of [[{ source: '' }], [{ source: 'https://example.com/video.mp4' }], [{ source: file, mimeType: 'image/png' }],
    [{ source: file, processing: 'unknown' }], [{ source: file, resolution: 'bogus' }],
    Array.from({ length: 11 }, () => ({ source: file }))]) await assert.rejects(inspectVideos(specs));
  await writeFile(file, '');
  await assert.rejects(inspectVideos([{ source: file }]), /nonempty/);
});

test('file processing handles ACTIVE, FAILED, unknown and timeout states', async () => {
  const client = fake();
  assert.equal((await waitForFile(client, { name: 'files/test', state: 'PROCESSING' }, ctx())).state, 'ACTIVE');
  await assert.rejects(waitForFile(client, { name: 'files/test', state: 'FAILED', error: { message: 'bad codec' } }, ctx()), /bad codec/);
  await assert.rejects(waitForFile(client, { name: 'files/test' }, ctx()), /Unexpected/);
  let now = 0;
  const context = createContext({ timeout: 1 }, { now: () => now++, sleep: async () => { now += 1000; } });
  const stuck = fake({ files: { get: async () => ({ state: 'PROCESSING', name: 'files/test' }) } });
  await assert.rejects(waitForFile(stuck, { state: 'PROCESSING', name: 'files/test' }, context), /Timed out/);
});

test('cleanup on processing/generation failure, but retains files for uncertain background task', async t => {
  const file = await fixture(t);
  const videos = await inspectVideos([{ source: file, transport: 'upload' }]);
  for (const background of [false, true]) {
    const client = fake({ interactions: { create: async () => { throw new Error('connection lost'); } } });
    await assert.rejects(analyze(client, videos, 'x', { cleanup: true, background }, ctx()), /connection lost/);
    assert.equal(client.calls.some(c => c[0] === 'delete'), !background);
  }
  const client = fake({ files: { upload: async () => ({ name: 'files/bad', state: 'FAILED' }) } });
  await assert.rejects(analyze(client, videos, 'x', { cleanup: true }, ctx()), /processing failed/);
  assert.deepEqual(client.calls, [['delete', { name: 'files/bad' }]]);
});

test('background waits, handles terminal failures and returns immediately when requested', async () => {
  const videos = await inspectVideos([{ source: 'https://youtu.be/test', processing: 'agentic' }]);
  const client = fake({ interactions: { create: async () => ({ id: 'job', status: 'in_progress' }) } });
  const response = await analyze(client, videos, 'x', { background: true }, ctx());
  assert.equal(response.result.status, 'completed');
  const submitted = await analyze(client, videos, 'x', { background: true, noWait: true }, ctx());
  assert.equal(submitted.result.status, 'in_progress');
  for (const status of ['failed', 'cancelled', 'requires_action', 'incomplete']) await assert.rejects(waitForInteraction(client, { id: 'x', status }, ctx()), new RegExp(status));
  let now = 0;
  const context = createContext({ timeout: 1 }, { now: () => now += 1001 });
  await assert.rejects(waitForInteraction(client, { id: 'job', status: 'in_progress' }, context), /jobs get job --wait/);
});

test('stateful IDs and stateless processing steps are preserved', async () => {
  const history = [{ type: 'user_input', content: [{ type: 'video', uri: 'files/x' }] },
    { type: 'processing_call', id: 'p' }, { type: 'processing_result', call_id: 'p' },
    { type: 'model_output', content: [{ type: 'text', text: 'old' }] }];
  const client = fake();
  await analyze(client, [], 'next', { history, noStore: true }, ctx());
  assert.deepEqual(client.calls[0][1].input.slice(0, 4), history);
  assert.equal(client.calls[0][1].store, false);
  await analyze(client, [], 'next', { previous: 'previous-id' }, ctx());
  assert.equal(client.calls[1][1].previous_interaction_id, 'previous-id');
});

test('streams text and fetches complete stored steps only when needed', async () => {
  async function* events() {
    yield { event_type: 'interaction.created', interaction: { id: 'stream-1' } };
    yield { event_type: 'step.delta', delta: { type: 'thought_summary', text: 'hidden' } };
    yield { event_type: 'step.delta', delta: { type: 'text', text: 'A useful ' } };
    yield { event_type: 'step.delta', delta: { type: 'text', text: 'summary.' } };
    yield { event_type: 'interaction.completed', interaction: { id: 'stream-1', status: 'completed' } };
  }
  const client = fake({ interactions: { create: async () => events() } });
  let text = '';
  const context = createContext({}, { onText: chunk => { text += chunk; } });
  const response = await analyze(client, [], 'x', { stream: true }, context);
  assert.equal(text, 'A useful summary.');
  assert.equal(response.text, text);
  await analyze(client, [], 'x', { stream: true, fullResponse: true }, ctx());
  assert.deepEqual(client.calls, [['interactionGet', 'stream-1']]);
});

test('stream failures and missing completion are errors', async () => {
  async function* broken() { yield { event_type: 'error', error: { message: 'bad stream' } }; }
  async function* empty() { yield { event_type: 'step.delta', delta: { type: 'text', text: 'partial' } }; }
  for (const stream of [broken, empty]) await assert.rejects(analyze(fake({ interactions: { create: async () => stream() } }), [], 'x', { stream: true }, ctx()));
});

test('output text excludes intermediate model outputs separated by processing', () => {
  assert.equal(outputText({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'old' }] },
    { type: 'processing_result' }, { type: 'model_output', content: [{ type: 'text', text: 'new' }] }] }), 'new');
});

test('installed official SDK serializes actual Interactions requests against a local HTTP fixture', async t => {
  let received;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received = { path: req.url, body: JSON.parse(body) };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(done));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = new GoogleGenAI({ apiKey: 'local-test-key' });
  const request = { model: 'gemini-3.8-flash', store: false, input: [{ type: 'video', uri: 'https://youtu.be/test',
    processing: processing({ start: 10, end: 20, fps: 0.5 }), resolution: 'high' }, { type: 'text', text: 'Describe.' }] };
  const response = await client.interactions.create(request, { server_url: `http://127.0.0.1:${server.address().port}`, retries: { strategy: 'none' } });
  assert.equal(response.output_text, 'A useful summary.');
  assert.match(received.path, /interactions/);
  assert.deepEqual(received.body, request);
});
