import { readFile, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function parts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Expected a stable semantic version, got ${version}`);
  }
  const result = version.split('.').map(Number);
  if (result.some(n => !Number.isSafeInteger(n))) throw new Error(`Version exceeds safe integer range: ${version}`);
  return result;
}
function compare(a, b) {
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function selectRelease(manifest, registry, commit) {
  parts(manifest.version);
  const versions = Object.values(registry.versions ?? {});
  const existing = versions.find(v => v.gitHead === commit);
  if (existing) return { publish: false, version: existing.version };
  const stable = versions.map(v => v.version).filter(v => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v)).sort(compare);
  const latest = stable.at(-1);
  if (!latest || compare(manifest.version, latest) > 0) return { publish: true, version: manifest.version };
  const next = parts(latest);
  next[2] += 1;
  const version = next.join('.');
  parts(version);
  return { publish: true, version };
}

export async function registryMetadata(name) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Registry metadata request failed: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/main' || !process.env.GITHUB_SHA || !process.env.GITHUB_OUTPUT) {
    throw new Error('Release preparation must run in GitHub Actions on main');
  }
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const selected = selectRelease(manifest, await registryMetadata(manifest.name), process.env.GITHUB_SHA);
  if (selected.publish) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFileSync(npm, ['version', selected.version, '--no-git-tag-version', '--allow-same-version', '--ignore-scripts'], { stdio: 'inherit' });
    execFileSync(npm, ['pkg', 'set', `gitHead=${process.env.GITHUB_SHA}`], { stdio: 'inherit' });
  }
  await appendFile(process.env.GITHUB_OUTPUT, `publish=${selected.publish}\nversion=${selected.version}\n`);
  console.log(selected.publish ? `Publishing ${manifest.name}@${selected.version}` : `Commit already published as ${selected.version}; skipping`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
