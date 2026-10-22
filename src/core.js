import { readFile, stat } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const REQUEST_LIMIT = 20_000_000;
const FILE_LIMIT = 2_000_000_000;
const MIME = { '.mp4': 'video/mp4', '.mpeg': 'video/mpeg', '.mpg': 'video/mpg',
  '.mov': 'video/mov', '.avi': 'video/avi', '.flv': 'video/x-flv',
  '.webm': 'video/webm', '.wmv': 'video/wmv', '.3gp': 'video/3gpp', '.3gpp': 'video/3gpp' };

export class UsageError extends Error {}
export function choice(value, values, label) {
  if (!values.includes(value)) throw new UsageError(`${label}: expected ${values.join(', ')}; got ${value}`);
  return value;
}
export function number(value, label, { min = 0, integer = false, exclusive = false } = {}) {
  const n = typeof value === 'number' ? value : Number(value);
  if (value === '' || !Number.isFinite(n) || (exclusive ? n <= min : n < min) || (integer && !Number.isInteger(n))) {
    throw new UsageError(`${label}: expected ${integer ? 'integer' : 'number'} ${exclusive ? '>' : '>='} ${min}`);
  }
  return n;
}
export function seconds(value, label) {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && value.includes(':')) {
    const parts = value.split(':');
    if (parts.length < 2 || parts.length > 3 || !parts.every(p => /^\d+(?:\.\d+)?$/.test(p)) ||
        parts.slice(1).some(p => Number(p) >= 60) || parts.slice(0, -1).some(p => !/^\d+$/.test(p))) {
      throw new UsageError(`${label}: use seconds, MM:SS or HH:MM:SS`);
    }
    return parts.reduce((sum, p) => sum * 60 + Number(p), 0);
  }
  return number(value, label);
}
export function processing(spec) {
  const mode = choice(spec.processing ?? 'static', ['static', 'agentic'], 'processing');
  const start = seconds(spec.start, 'start');
  const end = seconds(spec.end, 'end');
  const fps = spec.fps === undefined ? undefined : number(spec.fps, 'fps', { exclusive: true });
  if (mode === 'agentic' && [start, end, fps].some(v => v !== undefined)) {
    throw new UsageError('start, end and fps require static processing');
  }
  if (end !== undefined && end <= (start ?? 0)) throw new UsageError('end must be greater than start');
  if ([start, end, fps].every(v => v === undefined)) return mode;
  return { type: 'static', ...(start !== undefined && { start_offset: `${start}s` }),
    ...(end !== undefined && { end_offset: `${end}s` }), ...(fps !== undefined && { fps }) };
}
export function mimeType(path, override) {
  const mime = override ?? MIME[extname(path).toLowerCase()];
  if (!Object.values(MIME).includes(mime)) throw new UsageError(`Unsupported video type: ${override ?? path}. Use --mime-type for extensionless files.`);
  return mime;
}
function sourceKind(source) {
  if (/^files\/[A-Za-z0-9_-]+$/.test(source)) return 'file';
  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source);
    if (url.protocol === 'https:' && (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname))) return 'youtube';
    if (url.protocol === 'https:' && url.hostname === 'generativelanguage.googleapis.com' && /^\/v1beta\/files\/[A-Za-z0-9_-]+$/.test(url.pathname) && !url.search) return 'file';
    throw new UsageError('Only public YouTube URLs and Gemini Files API URIs are supported; download other URLs first.');
  }
  return 'local';
}
export function fileName(source) {
  return source.startsWith('https:') ? new URL(source).pathname.replace(/^\/v1beta\//, '') : source;
}
export async function inspectVideos(specs) {
  if (specs.length > 10) throw new UsageError('At most 10 videos are allowed per request');
  const result = [];
  for (const spec of specs) {
    if (!spec || typeof spec.source !== 'string' || !spec.source.trim()) throw new UsageError('Every video requires a nonempty source');
    const kind = sourceKind(spec.source);
    const part = { type: 'video', processing: processing(spec) };
    if (spec.resolution) part.resolution = choice(spec.resolution, ['low', 'medium', 'high', 'ultra_high'], 'resolution');
    if (spec.name) part.name = spec.name;
    const transport = choice(spec.transport ?? 'auto', ['upload', 'inline', 'auto'], 'transport');
    let size = 0;
    if (kind === 'local') {
      const info = await stat(spec.source);
      if (!info.isFile() || info.size === 0) throw new UsageError(`Video must be a nonempty regular file: ${spec.source}`);
      size = info.size;
      if (size > FILE_LIMIT) throw new UsageError(`Video exceeds Files API 2 GB limit: ${spec.source}`);
      part.mime_type = mimeType(spec.source, spec.mimeType);
    } else if (spec.mimeType) part.mime_type = mimeType(spec.source, spec.mimeType);
    result.push({ ...spec, kind, transport, size, part });
  }
  return result;
}
export function buildRequest(options, input) {
  const request = { model: options.model ?? DEFAULT_MODEL, input, store: !options.noStore };
  if (options.previous) request.previous_interaction_id = options.previous;
  if (options.system) request.system_instruction = options.system;
  if (options.background) request.background = true;
  if (options.stream) request.stream = true;
  if (options.maxTokens !== undefined) request.generation_config = { max_output_tokens: options.maxTokens };
  return request;
}
export function validateOptions(options) {
  if (options.noStore && (options.previous || options.background)) throw new UsageError('--no-store cannot be combined with --previous or --background');
  if (options.stream && options.background) throw new UsageError('Use --stream or --background, not both');
  if (options.noWait && !options.background) throw new UsageError('--no-wait requires --background');
  if (options.cleanup && options.noWait) throw new UsageError('--cleanup requires waiting for completion');
  if (options.history && options.previous) throw new UsageError('--history and --previous are mutually exclusive');
}
export async function waitForFile(client, file, context) {
  const deadline = context.now() + context.timeout * 1000;
  for (;;) {
    if (file.state === 'ACTIVE') {
      if (!file.uri || !file.mimeType) throw new Error(`File ${file.name} has no URI or MIME type`);
      return file;
    }
    if (file.state === 'FAILED') throw new Error(`File processing failed: ${file.name}: ${file.error?.message ?? 'unknown reason'}`);
    if (file.state !== 'PROCESSING') throw new Error(`Unexpected file state: ${file.state ?? 'missing'}`);
    if (context.now() >= deadline) throw new Error(`Timed out waiting for file ${file.name}; it remains available via files get`);
    context.log(`Processing ${file.name}...`);
    await context.sleep(Math.min(context.poll * 1000, deadline - context.now()));
    file = await client.files.get({ name: file.name });
  }
}
export async function uploadVideo(client, path, mime, context, onUploaded = () => {}) {
  context.log(`Uploading ${basename(path)}...`);
  const file = await client.files.upload({ file: path, config: { mimeType: mime, displayName: basename(path) } });
  if (!file.name) throw new Error('Upload response did not include a file name');
  onUploaded(file.name);
  context.log(`Uploaded ${file.name}`);
  return waitForFile(client, file, context);
}
export function outputText(result) {
  if (typeof result.output_text === 'string') return result.output_text;
  const texts = [];
  for (let i = (result.steps?.length ?? 0) - 1; i >= 0; i--) {
    const step = result.steps[i];
    if (step.type !== 'model_output') { if (texts.length) break; else continue; }
    texts.unshift((step.content ?? []).filter(p => p.type === 'text').map(p => p.text ?? '').join(''));
  }
  return texts.join('');
}
export function assertCompleted(result) {
  if (result.status !== 'completed') throw new Error(`Interaction ${result.id ?? ''} ended with status ${result.status ?? 'missing'}: ${JSON.stringify(result.errors ?? result.error ?? [])}`);
  return result;
}
export async function waitForInteraction(client, result, context) {
  const deadline = context.now() + context.timeout * 1000;
  while (result.status === 'in_progress') {
    if (context.now() >= deadline) throw new Error(`Timed out; resume with: gemini-video jobs get ${result.id} --wait`);
    await context.sleep(Math.min(context.poll * 1000, deadline - context.now()));
    result = await client.interactions.get(result.id, {}, { timeout_ms: context.timeout * 1000 });
  }
  return assertCompleted(result);
}
export function createContext(options = {}, overrides = {}) {
  return { timeout: options.timeout ?? 600, poll: options.poll ?? 2, log: () => {}, sleep: delay, now: Date.now, ...overrides };
}
// The installed SDK represents stateless step_list input as an array of steps.
export function withHistory(history, content) {
  if (history === undefined) return content;
  if (!Array.isArray(history) || history.some(s => !s || typeof s.type !== 'string')) throw new UsageError('History must be a full array of interaction steps');
  return [...history, { type: 'user_input', content }];
}
export async function analyze(client, videos, prompt, options, context) {
  validateOptions(options);
  const uploaded = [];
  let safeToDelete = true;
  try {
    const parts = [];
    // Reserve room for prompt, history, config and JSON/base64 framing before inline allocation.
    let bytes = Buffer.byteLength(JSON.stringify(buildRequest(options, withHistory(options.history, [{ type: 'text', text: prompt }])))) + 64_000;
    for (const video of videos) {
      const part = { ...video.part };
      if (video.kind === 'local') {
        const encodedBytes = 4 * Math.ceil(video.size / 3) + Buffer.byteLength(JSON.stringify(part));
        const inline = video.transport === 'inline' || (video.transport === 'auto' && bytes + encodedBytes < REQUEST_LIMIT);
        if (inline) {
          if (bytes + encodedBytes >= REQUEST_LIMIT) throw new UsageError('Combined inline request exceeds 20 MB; use --transport upload');
          bytes += encodedBytes;
          part.data = options.dryRun ? `<base64: ${video.size} bytes>` : (await readFile(video.source)).toString('base64');
        } else if (options.dryRun) {
          part.uri = `<upload: ${video.source}>`;
        } else {
          const file = await uploadVideo(client, video.source, part.mime_type, context, name => uploaded.push(name));
          part.uri = file.uri;
        }
      } else if (video.kind === 'file') {
        if (options.dryRun) part.uri = `<existing: ${fileName(video.source)}>`;
        else {
          const file = await waitForFile(client, await client.files.get({ name: fileName(video.source) }), context);
          part.uri = file.uri;
          part.mime_type = file.mimeType;
        }
      } else part.uri = video.source;
      parts.push(part);
    }
    parts.push({ type: 'text', text: prompt });
    const request = buildRequest(options, withHistory(options.history, parts));
    if (options.dryRun) return { request };
    if (Buffer.byteLength(JSON.stringify(request)) >= REQUEST_LIMIT) throw new UsageError('Request exceeds 20 MB; use uploaded files or shorter history');
    // On network loss, a background task may still be consuming these files.
    if (options.background) safeToDelete = false;
    const response = await client.interactions.create(request, { timeout_ms: context.timeout * 1000 });
    let result;
    if (options.stream) {
      let final;
      let streamed = '';
      for await (const event of response) {
        if (event.event_type === 'error') throw new Error(event.error?.message ?? JSON.stringify(event));
        if (event.event_type === 'step.delta' && event.delta?.type === 'text') {
          streamed += event.delta.text ?? '';
          context.onText?.(event.delta.text ?? '');
        }
        if (event.event_type === 'interaction.created') context.log(`Interaction: ${event.interaction.id}`);
        if (event.event_type === 'interaction.completed') final = event.interaction;
      }
      if (!final) throw new Error('Stream ended without interaction.completed');
      result = { ...final, output_text: outputText(final) || streamed };
      assertCompleted(result);
      // Lifecycle SSE events are partial. Retrieve stored steps for exact JSON/history,
      // including agentic processing_call/processing_result and thought signatures.
      if (options.fullResponse) result = assertCompleted(await client.interactions.get(result.id, {}, { timeout_ms: context.timeout * 1000 }));
    } else {
      result = response;
      context.log(`Interaction: ${result.id}`);
      if (options.background && !options.noWait) result = await waitForInteraction(client, result, context);
      else if (!options.noWait) assertCompleted(result);
    }
    if (result.status !== 'in_progress') safeToDelete = true;
    return { result, text: outputText(result), uploaded, content: parts };
  } finally {
    if (options.cleanup && safeToDelete) {
      for (const name of uploaded) {
        try { await client.files.delete({ name }); context.log(`Deleted ${name}`); }
        catch { context.log(`Cleanup failed for ${name}; delete with: gemini-video files delete ${name}`); }
      }
    } else if (options.cleanup && uploaded.length) context.log(`Background state uncertain; retained files: ${uploaded.join(', ')}`);
  }
}
