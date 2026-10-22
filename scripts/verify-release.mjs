import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { registryMetadata } from './prepare-release.mjs';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const deadline = Date.now() + 10 * 60_000;
while (true) {
  const registry = await registryMetadata(manifest.name);
  const version = registry.versions?.[manifest.version];
  if (version && version.gitHead !== process.env.GITHUB_SHA) {
    throw new Error(`Published version ${manifest.version} belongs to a different commit`);
  }
  if (version && registry['dist-tags']?.latest === manifest.version) {
    console.log(`Verified ${manifest.name}@${manifest.version} from commit ${version.gitHead}`);
    break;
  }
  if (Date.now() >= deadline) throw new Error('Registry propagation timed out; check npm before retrying the workflow');
  console.log('Waiting for npm registry propagation...');
  await setTimeout(15_000);
}
