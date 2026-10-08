import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parse } from 'yaml';

test('action entrypoints, inputs, and post condition form a consistent package', async () => {
  const action = parse(await readFile('action.yml', 'utf8'));
  assert.equal(action.runs.using, 'node24');
  assert.equal(action.runs['post-if'], 'success()');
  assert.equal(action.inputs.cache.default, 'true');
  assert.equal(action.inputs['cache-toolchain'].default, 'true');
  const main = await readFile('src/main.ts', 'utf8');
  for (const match of main.matchAll(/core\.get(?:Boolean)?Input\('([^']+)'\)/g))
    assert.ok(action.inputs[match[1] ?? ''], `Undeclared input: ${match[1]}`);
  for (const match of main.matchAll(/core\.setOutput\('([^']+)'/g))
    assert.ok(action.outputs[match[1] ?? ''], `Undeclared output: ${match[1]}`);
});

test('workflow actions are pinned and untrusted code does not receive write permissions', async () => {
  for (const file of await readdir('.github/workflows')) {
    const workflow = parse(await readFile(`.github/workflows/${file}`, 'utf8'));
    assert.equal(workflow.permissions.contents, 'read');
    assert.equal(workflow.on.pull_request_target, undefined);
    for (const job of Object.values(workflow.jobs) as Array<{
      steps?: Array<{ uses?: string }>;
      permissions?: Record<string, string>;
    }>) {
      for (const step of job.steps ?? []) {
        if (step.uses && !step.uses.startsWith('./')) assert.match(step.uses, /@[a-f0-9]{40}$/);
      }
      if (file !== 'release.yml') assert.notEqual(job.permissions?.contents, 'write');
    }
  }
});
