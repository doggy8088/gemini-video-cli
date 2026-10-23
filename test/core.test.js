import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { GoogleGenAI } from '@google/genai';
import { analyze, inspectVideos, processing, seconds, createContext, waitForFile,
  waitForInteraction, withHistory, validateOptions, outputText, REQUEST_LIMIT, uploadVideo } from '../src/core.js';

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

test('installed SDK uploads Unicode filenames with original metadata and exact bytes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-video-unicode-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const received = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    received.push({ path: req.url, headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/upload/v1beta/files') {
      res.setHeader('X-Goog-Upload-URL', `http://127.0.0.1:${server.address().port}/upload-bytes`);
      res.end('{}');
    } else {
      res.setHeader('X-Goog-Upload-Status', 'final');
      res.end(JSON.stringify({ file: { name: 'files/test', state: 'ACTIVE',
        uri: 'https://generativelanguage.googleapis.com/v1beta/files/test', mimeType: 'video/mp4' } }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = new GoogleGenAI({ apiKey: 'local-test-key',
    httpOptions: { baseUrl: `http://127.0.0.1:${server.address().port}` } });
  for (const name of ['特斯拉Roadster飛天跑車發表會展現飛行性能.zh-bilingual.burned.mp4', 'video-🚀.mp4', 'plain.mp4', '訪談-🎙️.mp3']) {
    const path = join(dir, name);
    const bytes = Buffer.from([0, 1, 2, 255]);
    await writeFile(path, bytes);
    const mime = name.endsWith('.mp3') ? 'audio/mp3' : 'video/mp4';
    const result = await uploadVideo(client, path, mime, ctx());
    assert.equal(result.state, 'ACTIVE');
    const [metadata, upload] = received.slice(-2);
    assert.equal(metadata.path, '/upload/v1beta/files');
    assert.equal(JSON.parse(metadata.body).file.displayName, name);
    assert.equal(metadata.headers['x-goog-upload-header-content-type'], mime);
    assert.equal(upload.path, '/upload-bytes');
    assert.deepEqual(upload.body, bytes);
  }
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
    processing: processing({ start: 10, end: 20, fps: 0.5 }), resolution: 'high' },
    { type: 'audio', data: 'AAECAw==', mime_type: 'audio/l16', sample_rate: 16000, channels: 1 },
    { type: 'audio', uri: 'https://generativelanguage.googleapis.com/v1beta/files/audio', mime_type: 'audio/mp3' },
    { type: 'text', text: 'Describe.' }] };
  const response = await client.interactions.create(request, { server_url: `http://127.0.0.1:${server.address().port}`, retries: { strategy: 'none' } });
  assert.equal(response.output_text, 'A useful summary.');
  assert.match(received.path, /interactions/);
  assert.deepEqual(received.body, request);
});

test('audio formats infer the content type and preserve exact inline bytes', async t => {
  const file = await fixture(t);
  const formats = { wav: 'wav', mp3: 'mp3', aiff: 'aiff', aif: 'aiff', aac: 'aac',
    ogg: 'ogg', oga: 'ogg', flac: 'flac', m4a: 'm4a', l16: 'l16', pcm: 'l16',
    opus: 'opus', alaw: 'alaw', mulaw: 'mulaw' };
  for (const [ext, mime] of Object.entries(formats)) {
    const path = `${file}.${ext.toUpperCase()}`;
    await writeFile(path, Buffer.from([0, 1, 2, 3]));
    const media = await inspectVideos([{ source: path }]);
    const client = fake();
    await analyze(client, media, 'Transcribe', {}, ctx());
    assert.deepEqual(client.calls[0][1].input[0], { type: 'audio', mime_type: `audio/${mime}`, data: 'AAECAw==' });
  }
});

test('audio WebM, extensionless files, raw metadata and names use the audio schema', async t => {
  const file = await fixture(t);
  const webm = `${file}.webm`;
  await writeFile(webm, 'webm');
  const media = await inspectVideos([
    { source: webm, type: 'audio' },
    { source: file, mimeType: 'audio/l16', sampleRate: 16000, channels: 1, name: 'Interview' },
  ]);
  const client = fake();
  await analyze(client, media, 'Compare', {}, ctx());
  const parts = client.calls[0][1].input;
  assert.equal(parts[0].mime_type, 'audio/webm');
  assert.deepEqual(parts[1], { type: 'text', text: 'Audio: Interview' });
  assert.deepEqual(parts[2], { type: 'audio', mime_type: 'audio/l16', sample_rate: 16000, channels: 1, data: 'AAECAw==' });
});

test('audio upload, existing-file inference, mixed inputs and cleanup share the lifecycle', async t => {
  const source = `${await fixture(t)}.mp3`;
  await writeFile(source, 'audio');
  const ready = { name: 'files/audio', state: 'ACTIVE', uri: 'https://generativelanguage.googleapis.com/v1beta/files/audio', mimeType: 'audio/mpeg' };
  const client = fake({ files: {
    upload: async arg => { client.calls.push(['upload', arg]); return ready; },
    get: async arg => { client.calls.push(['get', arg]); return ready; },
  } });
  const media = await inspectVideos([{ source, transport: 'upload' }, { source: ready.uri },
    { source: 'https://youtu.be/test', processing: 'agentic' }]);
  const result = await analyze(client, media, 'Compare', { cleanup: true }, ctx());
  assert.deepEqual(client.calls.map(c => c[0]), ['upload', 'get', 'create', 'delete']);
  assert.equal(client.calls[0][1].config.mimeType, 'audio/mp3');
  assert.deepEqual(result.content[1], { type: 'audio', mime_type: 'audio/mpeg', uri: ready.uri });
  assert.equal(result.content[2].processing, 'agentic');
  assert.equal(result.content[0].type, 'audio');
});

test('untyped Files references keep raw audio metadata until the server MIME is known', async () => {
  const [pending] = await inspectVideos([{ source: 'files/raw', sampleRate: 16000, channels: 1 }]);
  assert.deepEqual(pending.part, { type: 'audio', sample_rate: 16000, channels: 1 });
  const ready = { name: 'files/raw', state: 'ACTIVE', uri: 'https://generativelanguage.googleapis.com/v1beta/files/raw', mimeType: 'audio/l16' };
  const client = fake({ files: { get: async () => ready } });
  const result = await analyze(client, [pending], 'x', {}, ctx());
  assert.deepEqual(result.content[0], { type: 'audio', mime_type: 'audio/l16', sample_rate: 16000, channels: 1, uri: ready.uri });
  const [video] = await inspectVideos([{ source: 'files/raw', sampleRate: 16000 }]);
  const stored = fake({ files: { get: async () => ({ ...ready, mimeType: 'video/mp4' }) } });
  await assert.rejects(analyze(stored, [video], 'x', {}, ctx()), /require audio input/);
});

test('audio rejects video settings, type mismatches and invalid raw metadata', async t => {
  const file = await fixture(t);
  for (const extra of [{ processing: 'static' }, { processing: 'agentic' }, { start: 0 }, { end: 1 },
    { fps: 1 }, { resolution: 'low' }, { sampleRate: 0 }, { channels: 1.5 }, { type: 'video' }]) {
    await assert.rejects(inspectVideos([{ source: file, mimeType: 'audio/wav', ...extra }]));
  }
  await assert.rejects(inspectVideos([{ source: 'https://youtu.be/test', type: 'audio' }]), /YouTube/);
  await assert.rejects(inspectVideos([{ source: file, channels: 1 }]), /require audio/);
  const ready = { name: 'files/audio', state: 'ACTIVE', uri: 'files/audio', mimeType: 'audio/mp3' };
  const client = fake({ files: { get: async () => ready } });
  const media = await inspectVideos([{ source: 'files/audio', processing: 'agentic' }]);
  await assert.rejects(analyze(client, media, 'x', {}, ctx()), /Audio does not support/);
  assert.equal(client.calls.length, 0);
});

test('audio auto transport accounts for aggregate mixed-media size', async t => {
  const file = await fixture(t);
  await truncate(file, 8_000_000);
  const media = await inspectVideos([{ source: file }, { source: file, mimeType: 'audio/wav' }]);
  const { request } = await analyze(null, media, 'Compare', { dryRun: true }, ctx());
  assert.equal(request.input[1].type, 'audio');
  assert.match(request.input[1].uri, /upload/);
});

test('audio survives streaming, background submission and complete history replay', async t => {
  const file = await fixture(t);
  const media = await inspectVideos([{ source: file, mimeType: 'audio/wav' }]);
  const history = [{ type: 'user_input', content: [{ type: 'audio', uri: 'files/old', mime_type: 'audio/mp3' }] },
    { type: 'model_output', content: [{ type: 'text', text: 'Earlier transcript' }] }];
  const client = fake();
  await analyze(client, media, 'Continue', { history, noStore: true }, ctx());
  assert.deepEqual(client.calls[0][1].input.slice(0, 2), history);
  assert.equal(client.calls[0][1].input[2].content[0].type, 'audio');
  const background = fake({ interactions: { create: async request => {
    assert.equal(request.input[0].type, 'audio');
    return { id: 'audio-job', status: 'in_progress' };
  } } });
  assert.equal((await analyze(background, media, 'x', { background: true, noWait: true }, ctx())).result.id, 'audio-job');
  assert.equal((await analyze(background, media, 'x', { background: true }, ctx())).result.status, 'completed');
  async function* events() {
    yield { event_type: 'step.delta', delta: { type: 'text', text: 'Transcript' } };
    yield { event_type: 'interaction.completed', interaction: { id: 'audio-stream', status: 'completed' } };
  }
  const stream = fake({ interactions: { create: async request => {
    assert.equal(request.input[0].type, 'audio');
    return events();
  } } });
  assert.equal((await analyze(stream, media, 'x', { stream: true }, ctx())).text, 'Transcript');
});
