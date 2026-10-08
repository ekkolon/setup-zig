import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parse} from 'yaml';

const action = parse(await readFile('action.yml', 'utf8'));
const root = await mkdtemp(path.join(os.tmpdir(), 'setup-zig-smoke-'));
await cp('dist', path.join(root, 'action', 'dist'), {recursive: true});
const environment = {
  ...process.env,
  RUNNER_TEMP: root,
  RUNNER_TOOL_CACHE: path.join(root, 'tools'),
  GITHUB_WORKSPACE: process.cwd(),
};
for (const [name, input] of Object.entries(action.inputs)) {
  environment[`INPUT_${name.toUpperCase().replaceAll(' ', '_')}`] = String(
    input.default ?? '',
  );
}
environment.INPUT_VERSION = process.argv[2] ?? '0.17.0';
environment.INPUT_MIRROR = process.env.SETUP_ZIG_TEST_MIRROR ?? '';
environment['INPUT_CACHE-TOOLCHAIN'] = 'false';
environment.INPUT_CACHE = 'false';
try {
  for (let attempt = 0; attempt < 2; attempt++) {
    const pathFile = path.join(root, 'path');
    const outputFile = path.join(root, 'output');
    await writeFile(pathFile, '');
    await writeFile(outputFile, '');
    environment.GITHUB_PATH = pathFile;
    environment.GITHUB_OUTPUT = outputFile;
    execFileSync(
      process.execPath,
      [path.join(root, 'action', 'dist', 'main.js')],
      {
        env: environment,
        stdio: 'inherit',
        timeout: 600_000,
      },
    );
    const outputs = await readFile(outputFile, 'utf8');
    const hit = outputs.match(
      /toolchain-cache-hit<<[^\r\n]+\r?\n([^\r\n]+)/,
    )?.[1];
    assert.equal(hit, String(attempt === 1));
    const directory = (await readFile(pathFile, 'utf8')).trim();
    const zig = path.join(
      directory,
      process.platform === 'win32' ? 'zig.exe' : 'zig',
    );
    execFileSync(zig, ['test', 'test/fixtures/smoke.zig'], {
      stdio: 'inherit',
      timeout: 120_000,
    });
    // A warm exact pin must work with an unreachable mirror.
    if (
      /^\d+\.\d+\.\d+(?:-dev\.\d+\+[a-f0-9]+)?$/.test(environment.INPUT_VERSION)
    ) {
      environment.INPUT_MIRROR = 'https://unreachable.invalid';
    }
  }
} finally {
  await rm(root, {recursive: true, force: true});
}
