import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {parse} from 'yaml';

interface WorkflowJob {
  steps?: Array<{uses?: string}>;
  permissions?: Record<string, string>;
}

test('action entrypoints, inputs, and post condition form a consistent package', async () => {
  const action = parse(await readFile('action.yml', 'utf8'));
  assert.equal(action.name, 'Zig Toolchain Setup');
  assert.equal(action.runs.using, 'node24');
  assert.equal(action.runs['post-if'], 'success()');
  assert.equal(action.inputs.cache.default, 'true');
  assert.equal(action.inputs['cache-toolchain'].default, 'true');
  const main = await readFile('src/main.ts', 'utf8');
  for (const match of main.matchAll(
    /core\.get(?:Boolean)?Input\('([^']+)'\)/g,
  )) {
    assert.ok(action.inputs[match[1] ?? ''], `Undeclared input: ${match[1]}`);
  }
  for (const match of main.matchAll(/core\.setOutput\('([^']+)'/g)) {
    assert.ok(action.outputs[match[1] ?? ''], `Undeclared output: ${match[1]}`);
  }
});

test('workflow actions are pinned and untrusted code does not receive write permissions', async () => {
  for (const file of await readdir('.github/workflows')) {
    const workflow = parse(await readFile(`.github/workflows/${file}`, 'utf8'));
    assert.equal(workflow.permissions.contents, 'read');
    assert.equal(workflow.on.pull_request_target, undefined);
    const jobs: WorkflowJob[] = Object.values(workflow.jobs);
    for (const job of jobs) {
      for (const step of job.steps ?? []) {
        if (step.uses && !step.uses.startsWith('./')) {
          assert.match(step.uses, /@[a-f0-9]{40}$/);
        }
      }
      if (file !== 'release.yml') {
        assert.notEqual(job.permissions?.contents, 'write');
      }
    }
  }
});

test('releases require immutability and attest their archive and SBOM', async () => {
  const workflow = parse(
    await readFile('.github/workflows/release.yml', 'utf8'),
  );
  const validate = workflow.jobs.validate.steps.find(
    (step: {name?: string}) =>
      step.name === 'Validate release version and visibility',
  );
  assert.doesNotMatch(validate.run, /immutable-releases/);
  assert.match(validate.run, /REPOSITORY_PRIVATE/);

  const publish = workflow.jobs.publish;
  assert.equal(publish.permissions['id-token'], 'write');
  assert.equal(publish.permissions.attestations, 'write');
  assert.equal(publish.permissions['artifact-metadata'], 'write');

  const packageStep = publish.steps.find(
    (step: {name?: string}) => step.name === 'Prepare release assets',
  );
  assert.match(packageStep.run, /git archive/);
  assert.match(packageStep.run, /pnpm sbom[^\n]+--prod/);
  assert.match(packageStep.run, /sha256sum/);

  const attestations = publish.steps.filter((step: {uses?: string}) =>
    step.uses?.startsWith('actions/attest@'),
  );
  assert.equal(attestations.length, 2);
  assert.equal(
    attestations[0].with['subject-path'],
    'release/setup-zig-*.tar.gz',
  );
  assert.equal(attestations[1].with['sbom-path'], 'release/sbom.cdx.json');
  const publishScript: string = publish.steps.at(-1).run;
  assert.match(publishScript, /gh release create[^\n]+release\/\*/);
  const immutabilityCheck = publishScript.indexOf('--json isImmutable');
  assert.ok(immutabilityCheck > publishScript.indexOf('gh release create'));
  assert.ok(immutabilityCheck < publishScript.indexOf('major='));
});

test('CodeQL checks maintained source rather than generated bundles', async () => {
  const workflow = parse(
    await readFile('.github/workflows/codeql.yml', 'utf8'),
  );
  const steps = workflow.jobs.analyze.steps;
  const init = steps.find((step: {uses?: string}) =>
    step.uses?.startsWith('github/codeql-action/init@'),
  );
  const config = parse(init.with.config);
  assert.deepEqual(config.paths, ['src', 'scripts', 'test']);
  assert.ok(!config.paths.includes('dist'));
  assert.ok(
    steps.some((step: {uses?: string}) =>
      step.uses?.startsWith('github/codeql-action/analyze@'),
    ),
  );
});
