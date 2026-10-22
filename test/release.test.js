import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRelease } from '../scripts/prepare-release.mjs';

const manifest = { version: '0.1.0' };
const registry = (...versions) => ({ versions: Object.fromEntries(versions.map(v => [v.version, v])) });
test('first functional release follows the placeholder', () => {
  assert.deepEqual(selectRelease(manifest, registry({ version: '0.0.0' }, { version: '0.0.0-stage' }), 'sha'), { publish: true, version: '0.1.0' });
});
test('main commits automatically increment the highest stable patch', () => {
  assert.deepEqual(selectRelease(manifest, registry({ version: '0.1.9' }, { version: '0.1.10' }), 'sha'), { publish: true, version: '0.1.11' });
});
test('intentional minor versions take precedence over automatic patches', () => {
  assert.deepEqual(selectRelease({ version: '0.2.0' }, registry({ version: '0.1.9' }), 'sha'), { publish: true, version: '0.2.0' });
});
test('rerunning a published commit skips publishing', () => {
  assert.deepEqual(selectRelease(manifest, registry({ version: '0.1.1', gitHead: 'same-sha' }), 'same-sha'), { publish: false, version: '0.1.1' });
});
test('release versions must be stable semantic versions', () => {
  for (const version of ['0.1.0-beta', '01.2.3', 'not-a-version']) assert.throws(() => selectRelease({ version }, registry(), 'sha'));
});
