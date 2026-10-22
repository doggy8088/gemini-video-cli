#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { UsageError, DEFAULT_MODEL, number, validateOptions, inspectVideos, analyze,
  createContext, uploadVideo, fileName, outputText, waitForInteraction, mimeType } from './core.js';

const HELP = `gemini-video — Gemini video understanding CLI

Usage:
  gemini-video analyze -v VIDEO -p PROMPT [options]
  echo 'Summarize this video' | gemini-video -v VIDEO
  gemini-video files upload PATH [--mime-type TYPE]
  gemini-video files list | get files/NAME | delete files/NAME
  gemini-video jobs get ID [--wait] | cancel ID | delete ID

Inputs:
  -v, --video SOURCE       Repeat: local file, public YouTube URL, files/NAME
  -p, --prompt TEXT        Repeat; '-' reads prompt from STDIN
      --prompt-file PATH  Read UTF-8 prompt; combined with -p in that order
      --manifest PATH     JSON array of per-video settings (see README)
      --transport MODE    upload (default), inline, auto
      --mime-type TYPE    Override MIME for extensionless local files
      --processing MODE   static (default), agentic
      --start TIME        Seconds, MM:SS, HH:MM:SS (static only)
      --end TIME          Exclusive end time (static only)
      --fps NUMBER        Frame sampling rate > 0 (static only)
      --resolution LEVEL  low, medium, high, ultra_high

Generation:
      --model MODEL       Default: GEMINI_MODEL or ${DEFAULT_MODEL}
      --system TEXT       System instruction
      --max-tokens N      Maximum output tokens
      --previous ID       Continue stored interaction, video optional
      --history PATH      Full step array from --save-history (stateless replay)
      --save-history PATH Save complete input and response steps for replay
      --no-store          Disable server-side interaction storage
      --stream            Stream response text
      --background        Run server-side; poll by default
      --no-wait           Submit background job and print JSON immediately
      --cleanup           Delete only files uploaded in this run after completion

Output / operation:
      --json              Full response JSON (buffered even with --stream)
  -o, --output PATH       Save output instead of STDOUT
      --dry-run           Preview request without API or base64 payloads
      --wait              Wait for jobs get to finish
      --timeout SECONDS   HTTP / each processing wait timeout (default: 600)
      --poll SECONDS      Poll interval (default: 2)
  -q, --quiet             Hide progress on STDERR
  -h, --help              Show help
      --version           Show version

Authentication: GEMINI_API_KEY or GOOGLE_API_KEY. Use Node --env-file for .env.
Exit codes: 0 success, 1 API/I/O/processing failure, 2 invalid arguments.
`;
const definitions = {
  video: { type: 'string', short: 'v', multiple: true }, prompt: { type: 'string', short: 'p', multiple: true },
  'prompt-file': { type: 'string' }, manifest: { type: 'string' }, transport: { type: 'string' },
  'mime-type': { type: 'string' }, processing: { type: 'string' }, start: { type: 'string' },
  end: { type: 'string' }, fps: { type: 'string' }, resolution: { type: 'string' },
  model: { type: 'string' }, system: { type: 'string' }, 'max-tokens': { type: 'string' },
  previous: { type: 'string' }, history: { type: 'string' }, 'save-history': { type: 'string' },
  'no-store': { type: 'boolean' }, stream: { type: 'boolean' }, background: { type: 'boolean' },
  'no-wait': { type: 'boolean' }, cleanup: { type: 'boolean' }, json: { type: 'boolean' },
  output: { type: 'string', short: 'o' }, 'dry-run': { type: 'boolean' }, wait: { type: 'boolean' },
  timeout: { type: 'string' }, poll: { type: 'string' }, quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
};
const jsonFile = async path => {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error instanceof SyntaxError) throw new UsageError(`Invalid JSON in ${path}: ${error.message}`); throw error; }
};
async function stdin() {
  if (process.stdin.isTTY) throw new UsageError('Prompt missing; use --prompt, --prompt-file or pipe text to STDIN');
  process.stdin.setEncoding('utf8');
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}
async function main() {
  let parsed;
  try { parsed = parseArgs({ options: definitions, allowPositionals: true, strict: true }); }
  catch (error) { throw new UsageError(error.message); }
  const { values: v, positionals } = parsed;
  if (v.help) { process.stdout.write(HELP); return; }
  if (v.version) { process.stdout.write('0.1.0\n'); return; }
  const command = positionals[0] ?? 'analyze';
  if (!['analyze', 'files', 'jobs'].includes(command)) throw new UsageError(`Unknown command: ${command}`);
  const allowed = command === 'analyze' ? Object.keys(definitions).filter(k => k !== 'wait') :
    ['json', 'output', 'timeout', 'poll', 'quiet', ...(command === 'files' && positionals[1] === 'upload' ? ['mime-type'] : []), ...(command === 'jobs' && positionals[1] === 'get' ? ['wait'] : [])];
  for (const key of Object.keys(v)) if (!allowed.includes(key)) throw new UsageError(`--${key} is not valid for this command`);
  const options = {
    model: v.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL, system: v.system, previous: v.previous,
    maxTokens: v['max-tokens'] === undefined ? undefined : number(v['max-tokens'], 'max-tokens', { integer: true, exclusive: true }),
    noStore: v['no-store'], background: v.background, noWait: v['no-wait'], stream: v.stream,
    cleanup: v.cleanup, dryRun: v['dry-run'],
    timeout: v.timeout === undefined ? 600 : number(v.timeout, 'timeout', { exclusive: true }),
    poll: v.poll === undefined ? 2 : number(v.poll, 'poll', { exclusive: true }),
  };
  const context = createContext(options, { log: text => { if (!v.quiet) process.stderr.write(`${text}\n`); } });
  const emit = async text => {
    const out = text.endsWith('\n') ? text : `${text}\n`;
    if (v.output) await writeFile(v.output, out, { mode: 0o600 });
    else process.stdout.write(out);
  };
  const client = () => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new UsageError('Set GEMINI_API_KEY or GOOGLE_API_KEY (not required for --dry-run)');
    return new GoogleGenAI({ apiKey, httpOptions: { timeout: options.timeout * 1000 } });
  };
  if (command === 'files' || command === 'jobs') {
    const [, action, id, ...extra] = positionals;
    const actions = command === 'files' ? ['upload', 'list', 'get', 'delete'] : ['get', 'cancel', 'delete'];
    if (!actions.includes(action) || extra.length || (action === 'list' ? id !== undefined : !id)) throw new UsageError(`Usage: gemini-video ${command} ${actions.join('|')} ${command === 'files' ? 'PATH_OR_NAME' : 'ID'}`);
    let result;
    // Validate local input before constructing the authenticated client.
    const upload = command === 'files' && action === 'upload' ? (await inspectVideos([{ source: id, mimeType: v['mime-type'] }]))[0] : undefined;
    if (upload && upload.kind !== 'local') throw new UsageError('files upload requires a local video path');
    if (command === 'files' && ['get', 'delete'].includes(action) && !/^files\/[A-Za-z0-9_-]+$/.test(fileName(id))) throw new UsageError('Expected files/NAME or a Files API URI');
    const ai = client();
    if (command === 'files') {
      if (action === 'upload') result = await uploadVideo(ai, id, mimeType(id, v['mime-type']), context);
      if (action === 'list') {
        result = [];
        for await (const file of await ai.files.list({ config: { pageSize: 100 } })) result.push(file);
      }
      if (action === 'get') result = await ai.files.get({ name: fileName(id) });
      if (action === 'delete') { await ai.files.delete({ name: fileName(id) }); result = { deleted: fileName(id) }; }
    } else {
      if (action === 'get') {
        result = await ai.interactions.get(id, {}, { timeout_ms: options.timeout * 1000 });
        if (v.wait) result = await waitForInteraction(ai, result, context);
      }
      if (action === 'cancel') result = await ai.interactions.cancel(id);
      if (action === 'delete') { await ai.interactions.delete(id); result = { deleted: id }; }
    }
    await emit(JSON.stringify(result, null, 2));
    return;
  }
  if (positionals.length > 1) throw new UsageError('Use --video for every video path or URL');
  if (v.history) options.history = await jsonFile(v.history);
  validateOptions(options);
  if (v['save-history'] && (options.previous || options.noWait)) throw new UsageError('--save-history requires --history or a new conversation, and a completed response');
  if (options.stream && options.noStore && (v.json || v['save-history'])) throw new UsageError('Full streamed JSON/history requires storage; omit --no-store or --stream');
  options.fullResponse = !!(v.json || v['save-history']);
  const prompts = [];
  const flags = v.prompt ?? [];
  if (flags.filter(p => p === '-').length > 1) throw new UsageError('STDIN can be read only once');
  for (const prompt of flags) prompts.push(prompt === '-' ? await stdin() : prompt);
  if (v['prompt-file']) prompts.push(await readFile(v['prompt-file'], 'utf8'));
  if (!flags.length && !v['prompt-file']) prompts.push(await stdin());
  const prompt = prompts.join('\n\n').trim();
  if (!prompt) throw new UsageError('Prompt cannot be empty');
  const defaults = { transport: v.transport, mimeType: v['mime-type'], processing: v.processing,
    start: v.start, end: v.end, fps: v.fps, resolution: v.resolution };
  const specs = (v.video ?? []).map(source => ({ ...defaults, source }));
  if (v.manifest) {
    const manifest = await jsonFile(v.manifest);
    if (!Array.isArray(manifest)) throw new UsageError('Manifest must be an array');
    const keys = ['source', 'transport', 'mimeType', 'processing', 'start', 'end', 'fps', 'resolution', 'name'];
    for (const spec of manifest) {
      if (!spec || typeof spec !== 'object' || Array.isArray(spec) || Object.keys(spec).some(k => !keys.includes(k))) throw new UsageError(`Manifest entries allow only: ${keys.join(', ')}`);
      const merged = { ...defaults, ...spec };
      if (typeof merged.source === 'string' && !/^https?:\/\//i.test(merged.source) && !merged.source.startsWith('files/') && !isAbsolute(merged.source)) merged.source = resolve(dirname(v.manifest), merged.source);
      specs.push(merged);
    }
  }
  if (!specs.length && !options.previous && !options.history?.length) throw new UsageError('Provide --video, --manifest, --previous or --history');
  const videos = await inspectVideos(specs);
  // Validate history even during dry-run, before any network effects.
  if (options.history && (!Array.isArray(options.history) || options.history.some(s => !s || typeof s.type !== 'string'))) throw new UsageError('History must be an array of steps');
  let streamed = false;
  if (options.stream && !v.json && !v.output && !options.dryRun) {
    context.onText = text => { process.stdout.write(text); streamed ||= !!text; };
  }
  const response = await analyze(options.dryRun ? null : client(), videos, prompt, options, context);
  if (v['save-history'] && !options.dryRun) {
    const previousSteps = options.history ?? [];
    await writeFile(v['save-history'], JSON.stringify([...previousSteps, { type: 'user_input', content: response.content }, ...(response.result.steps ?? []).filter(s => s.type !== 'user_input')], null, 2) + '\n', { mode: 0o600 });
  }
  if (options.dryRun) await emit(JSON.stringify(response.request, null, 2));
  else if (v.json || options.noWait) await emit(JSON.stringify(response.result, null, 2));
  else if (streamed) process.stdout.write('\n');
  else await emit(response.text || outputText(response.result));
}
main().catch(error => {
  // Avoid echoing SDK request bodies or key-bearing URLs in diagnostics.
  let message = String(error.message ?? error);
  for (const secret of [process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY].filter(Boolean)) message = message.split(secret).join('[REDACTED]');
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
