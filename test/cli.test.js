import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const cli = resolve('src/cli.js');
const run = (args, input = '') => spawnSync(process.execPath, [cli, ...args], {
  input, encoding: 'utf8', env: { ...process.env, GEMINI_API_KEY: '', GOOGLE_API_KEY: '' },
});
const base = ['-v', 'https://youtu.be/test', '--dry-run'];

test('help/version require no credentials', () => {
  assert.match(run(['--help']).stdout, /gemini-video/);
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(run(['--version']).stdout.trim(), version);
});
test('-h hides -v/-a while --help lists them', () => {
  const short = run(['-h']).stdout;
  const long = run(['--help']).stdout;
  assert.match(short, /-i, --input/);
  for (const help of [short, long]) {
    assert.match(help, /^Commands:$/m);
    assert.match(help, /^ +analyze \(default\)/m);
    assert.match(help, /^ +files /m);
    assert.match(help, /^ +jobs /m);
  }
  assert.doesNotMatch(short, /^ +-v, --video/m);
  assert.doesNotMatch(short, /^ +-a, --audio/m);
  assert.match(long, /^ +-i, --input/m);
  assert.match(long, /^ +-v, --video/m);
  assert.match(long, /^ +-a, --audio/m);
});
test('STDIN, explicit STDIN and repeated prompts', () => {
  const a = run(base, '  Summarize from pipe\n');
  assert.equal(a.status, 0, a.stderr);
  assert.equal(JSON.parse(a.stdout).input.at(-1).text, 'Summarize from pipe');
  const b = run([...base, '-p', 'First', '-p', '-'], 'Second');
  assert.equal(b.status, 0, b.stderr);
  assert.equal(JSON.parse(b.stdout).input.at(-1).text, 'First\n\nSecond');
});
test('bad combinations, unknown arguments and missing inputs return exit 2', () => {
  for (const args of [['--bogus'], [...base, '-p', 'x', '--processing', 'agentic', '--fps', '2'],
    [...base, '-p', 'x', '--background', '--no-store'], [...base, '-p', 'x', '--timeout', 'NaN'],
    [...base, '-p', 'x', '--save-history', '/tmp/no-write', '--previous', 'id'],
    [...base, '-p', 'x', '--stream', '--json', '--no-store'], ['-p', 'x', '--dry-run'],
    [...base, '-p', '-', '-p', '-'], ['files', 'list', '--dry-run'], ['analyze', 'extra']]) {
    const result = run(args);
    assert.equal(result.status, 2, `${args}: ${result.stderr}`);
    assert.equal(result.stdout, '');
  }
});
test('missing credentials fail explicitly without making a request', () => {
  const result = run(['-v', 'https://youtu.be/test', '-p', 'x']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Set GEMINI_API_KEY/);
});
test('manifest relative files, mixed processing, prompt file, history and output file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-video-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'a.mp4'), 'fake-video');
  await writeFile(join(dir, 'videos.json'), JSON.stringify([
    { source: 'a.mp4', start: '00:05', end: 10 },
    { source: 'https://youtu.be/test', processing: 'agentic' },
  ]));
  await writeFile(join(dir, 'prompt.txt'), 'Prompt from file');
  await writeFile(join(dir, 'history.json'), JSON.stringify([{ type: 'processing_call', id: 'keep-me' }]));
  const out = join(dir, 'request.json');
  const result = run(['--manifest', join(dir, 'videos.json'), '--prompt-file', join(dir, 'prompt.txt'),
    '--history', join(dir, 'history.json'), '--no-store', '--dry-run', '-o', out]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  const { readFile } = await import('node:fs/promises');
  const request = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(request.input[0].id, 'keep-me');
  assert.equal(request.input[1].content[0].processing.start_offset, '5s');
  assert.match(request.input[1].content[0].data, /base64/);
  assert.equal(request.input[1].content[1].processing, 'agentic');
  assert.equal(request.input[1].content[2].text, 'Prompt from file');
});
test('invalid JSON is a usage error; missing file is an I/O error', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-video-bad-json-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bad = join(dir, 'bad.json');
  await writeFile(bad, 'not json');
  assert.equal(run(['--manifest', bad, '-p', 'x', '--dry-run']).status, 2);
  assert.equal(run(['-v', join(dir, 'missing.mp4'), '-p', 'x', '--dry-run']).status, 1);
});
test('UTF-8 Traditional Chinese prompts survive STDIN', () => {
  const result = run(base, '請用繁體中文摘要這段影片，並標示時間。');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).input.at(-1).text, '請用繁體中文摘要這段影片，並標示時間。');
});

test('default auto selects inline or upload by aggregate size and permits explicit upload', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-video-auto-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'video.mp4');
  await writeFile(file, 'small');
  const preview = args => {
    const result = run([...args, '-p', 'Summarize', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).input;
  };
  assert.match(preview(['-v', file])[0].data, /base64/);
  assert.match(preview(['-v', file, '--transport', 'upload'])[0].uri, /upload/);
  await truncate(file, 8_000_000);
  const multiple = preview(['-v', file, '-v', file]);
  assert.match(multiple[0].data, /base64/);
  assert.match(multiple[1].uri, /upload/);
  await truncate(file, 16_000_000);
  assert.match(preview(['-v', file])[0].uri, /upload/);
});

test('audio flags, mixed manifest, raw metadata and dry-run work without credentials', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-audio-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, '訪談.mp3');
  await writeFile(file, 'audio');
  const preview = args => {
    const result = run([...args, '-p', '逐字稿', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).input;
  };
  assert.deepEqual(preview(['--audio', file])[0], { type: 'audio', mime_type: 'audio/mp3', data: '<base64: 5 bytes>' });
  assert.match(preview(['-a', file, '--transport', 'upload'])[0].uri, /upload/);
  assert.equal(preview(['-a', 'files/existing'])[0].type, 'audio');
  assert.equal(preview(['-a', file, '-a', file]).filter(p => p.type === 'audio').length, 2);
  const mixed = preview(['-a', file, '-v', 'https://youtu.be/test']);
  assert.deepEqual(mixed.map(p => p.type), ['video', 'audio', 'text']);
  const raw = preview(['-a', file, '--mime-type', 'audio/l16', '--sample-rate', '16000', '--channels', '1'])[0];
  assert.equal(raw.sample_rate, 16000);
  assert.equal(raw.channels, 1);
  const manifest = join(dir, 'media.json');
  await writeFile(manifest, JSON.stringify([{ source: '訪談.mp3', name: 'Interview' },
    { source: 'files/existing', type: 'audio' }, { source: 'https://youtu.be/test', processing: 'agentic' }]));
  const parts = preview(['--manifest', manifest]);
  assert.deepEqual(parts.map(p => p.type), ['text', 'audio', 'audio', 'video', 'text']);
  for (const args of [['-a', file, '--fps', '1'], ['-a', file, '--start', '0'],
    ['-a', file, '--processing', 'agentic'], ['-a', file, '--channels', '0'],
    ['-v', file], ['-a', 'https://youtu.be/test']]) {
    const result = run([...args, '-p', 'x', '--dry-run']);
    assert.equal(result.status, 2, result.stderr);
  }
  // The upload command accepts audio and reaches credential validation.
  const upload = run(['files', 'upload', file]);
  assert.equal(upload.status, 2);
  assert.match(upload.stderr, /Set GEMINI_API_KEY/);
});

test('-i detects video or audio from the extension', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-input-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const name of ['clip.mp4', 'talk.mp3', 'talk.m4a', 'noext']) await writeFile(join(dir, name), 'x');
  const preview = args => {
    const result = run([...args, '-p', 'x', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).input;
  };
  assert.deepEqual(preview(['-i', join(dir, 'clip.mp4')])[0], { type: 'video', mime_type: 'video/mp4', processing: 'static', data: '<base64: 1 bytes>' });
  assert.deepEqual(preview(['-i', join(dir, 'talk.mp3')])[0], { type: 'audio', mime_type: 'audio/mp3', data: '<base64: 1 bytes>' });
  assert.equal(preview(['--input', join(dir, 'talk.m4a')])[0].mime_type, 'audio/m4a');
  assert.equal(preview(['-i', 'https://youtu.be/test'])[0].type, 'video');
  assert.deepEqual(preview(['-i', join(dir, 'talk.mp3'), '-i', join(dir, 'clip.mp4')]).map(p => p.type), ['audio', 'video', 'text']);
  assert.equal(preview(['-i', join(dir, 'noext'), '--mime-type', 'audio/mpeg'])[0].type, 'audio');
  const raw = preview(['-i', 'files/RAW', '--sample-rate', '16000', '--channels', '1'])[0];
  assert.deepEqual([raw.type, raw.sample_rate, raw.channels], ['audio', 16000, 1]);
  assert.equal(run(['-i', join(dir, 'noext'), '-p', 'x', '--dry-run']).status, 2);
  assert.equal(run(['-i', join(dir, 'talk.mp3'), '--fps', '1', '-p', 'x', '--dry-run']).status, 2);
});
