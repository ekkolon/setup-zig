import assert from 'node:assert/strict';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {
  getArchiveFilenames,
  parseMinimumZigVersion,
  parseVersionFile,
  parseVersionRequest,
  readVersionFile,
  resolvePlatform,
  resolveReleaseFromIndex,
  toToolCacheVersion,
} from '../src/version.ts';

for (const value of ['0.7.0', '0.17.0', '0.18.0-dev.35+5e754304d']) {
  test(`exact version ${value} retains its identity`, () =>
    assert.deepEqual(parseVersionRequest(value), {kind: 'exact', value}));
}
for (const value of ['0.17', '0.17.x', '^0.17.0', '>=0.15.1 <0.18.0', '*']) {
  test(`accepts range ${value}`, () =>
    assert.equal(parseVersionRequest(value).kind, 'range'));
}
for (const value of [
  '',
  '../../tmp',
  '0.17.0\n::error::bad',
  '$(whoami)',
  '0.17.0;echo bad',
  '0.17.0-dev.1',
  'https://example.com',
  '0.6.0',
  '01.17.0',
]) {
  test(`rejects invalid version ${JSON.stringify(value)}`, () =>
    assert.throws(() => parseVersionRequest(value)));
}
test('latest and master have distinct semantics', () => {
  assert.deepEqual(parseVersionRequest('latest'), {kind: 'range', value: '*'});
  assert.deepEqual(parseVersionRequest('master'), {
    kind: 'master',
    value: 'master',
  });
  assert.equal(parseVersionRequest(' v0.17.0 ').value, '0.17.0');
});

test('tool-cache versions distinguish development commits', () => {
  assert.notEqual(
    toToolCacheVersion('0.18.0-dev.35+aaaaaaa'),
    toToolCacheVersion('0.18.0-dev.35+bbbbbbb'),
  );
  assert.equal(toToolCacheVersion('0.17.0'), '0.17.0');
});

test('maps supported operating systems and architecture aliases', () => {
  assert.deepEqual(resolvePlatform('win32', 'arm64'), {
    os: 'windows',
    arch: 'aarch64',
  });
  assert.deepEqual(resolvePlatform('darwin', 'x64'), {
    os: 'macos',
    arch: 'x86_64',
  });
  assert.deepEqual(resolvePlatform('linux', 'x86'), {os: 'linux', arch: 'x86'});
  assert.throws(() => resolvePlatform('freebsd', 'x64'));
  assert.throws(() => resolvePlatform('darwin', 'ia32'));
  assert.throws(() => resolvePlatform('linux', 'arm'));
  assert.throws(() => resolvePlatform('__proto__', 'x64'));
  assert.throws(() => resolvePlatform('linux', 'constructor'));
});

test('archive names cover old releases and the development transition', () => {
  const linux = resolvePlatform('linux', 'x64');
  assert.deepEqual(getArchiveFilenames('0.13.0', linux), [
    'zig-linux-x86_64-0.13.0.tar.xz',
  ]);
  assert.deepEqual(getArchiveFilenames('0.14.1', linux), [
    'zig-x86_64-linux-0.14.1.tar.xz',
  ]);
  assert.equal(getArchiveFilenames('0.15.0-dev.1+aaaaaaa', linux).length, 2);
  assert.deepEqual(
    getArchiveFilenames('0.17.0', resolvePlatform('win32', 'arm64')),
    ['zig-aarch64-windows-0.17.0.zip'],
  );
});
const index = {
  master: {
    version: '0.18.0-dev.35+5e754304d',
    'x86_64-linux': {
      tarball:
        'https://ziglang.org/builds/zig-x86_64-linux-0.18.0-dev.35+5e754304d.tar.xz',
      shasum: 'a'.repeat(64),
      size: '40000',
    },
  },
  '0.17.0': {
    'x86_64-linux': {
      tarball:
        'https://ziglang.org/download/0.17.0/zig-x86_64-linux-0.17.0.tar.xz',
      shasum: 'b'.repeat(64),
      size: '50000',
    },
  },
  '0.16.0': {
    'x86_64-linux': {
      tarball:
        'https://ziglang.org/download/0.16.0/zig-x86_64-linux-0.16.0.tar.xz',
      shasum: 'c'.repeat(64),
      size: '30000',
    },
  },
};
test('latest excludes prereleases and ranges choose the highest matching release', () => {
  assert.equal(
    resolveReleaseFromIndex(
      index,
      parseVersionRequest('latest'),
      resolvePlatform('linux', 'x64'),
    ).version,
    '0.17.0',
  );
  assert.equal(
    resolveReleaseFromIndex(
      index,
      parseVersionRequest('0.16.x'),
      resolvePlatform('linux', 'x64'),
    ).version,
    '0.16.0',
  );
  assert.equal(
    resolveReleaseFromIndex(
      index,
      parseVersionRequest('master'),
      resolvePlatform('linux', 'x64'),
    ).version,
    index.master.version,
  );
  assert.throws(
    () =>
      resolveReleaseFromIndex(
        index,
        parseVersionRequest('0.15.x'),
        resolvePlatform('linux', 'x64'),
      ),
    /No published/,
  );
  assert.throws(
    () =>
      resolveReleaseFromIndex(
        index,
        parseVersionRequest('latest'),
        resolvePlatform('win32', 'arm64'),
      ),
    /no valid archive/,
  );
});

test('index cannot substitute another archive or host', () => {
  for (const tarball of [
    'http://ziglang.org/download/zig.tar.xz',
    'https://evil.example/zig-x86_64-linux-0.17.0.tar.xz',
    'https://ziglang.org/download/zig-x86_64-linux-0.16.0.tar.xz',
  ]) {
    const data = structuredClone(index);
    data['0.17.0']['x86_64-linux'].tarball = tarball;
    assert.throws(
      () =>
        resolveReleaseFromIndex(
          data,
          parseVersionRequest('latest'),
          resolvePlatform('linux', 'x64'),
        ),
      /unexpected/,
    );
  }
});

test('version files support plain versions, asdf, and the top-level ZON field', () => {
  assert.equal(parseVersionFile('\uFEFF0.17.0\r\n', '.zigversion'), '0.17.0');
  assert.equal(
    parseVersionFile('nodejs 24\nzig 0.17.0 # project\n', '.tool-versions'),
    '0.17.0',
  );
  assert.equal(
    parseMinimumZigVersion(
      '.{ // .minimum_zig_version = "0.8.0"\n .text = ".minimum_zig_version = \\"0.9.0\\"", .dep = .{ .minimum_zig_version = "0.10.0" }, .minimum_zig_version = // comment\n "0.17.0", }',
    ),
    '0.17.0',
  );
  assert.throws(() => parseVersionFile('zig 0.16.0 0.17.0', '.tool-versions'));
  assert.throws(() => parseVersionFile('0.16.0\n0.17.0', '.zigversion'));
  assert.throws(() =>
    parseMinimumZigVersion(
      '.{ .dependencies = .{ .minimum_zig_version = "0.17.0" } }',
    ),
  );
  assert.throws(() =>
    parseMinimumZigVersion('.{ .minimum_zig_version = @import("x") }'),
  );
  assert.throws(() =>
    parseMinimumZigVersion(
      '.{ .minimum_zig_version = "0.17.0", .minimum_zig_version = "0.16.0" }',
    ),
  );
});

test('version files cannot escape the workspace', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-zig-version-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const external = path.join(root, 'external');
  await writeFile(external, '0.17.0');
  const workspace = await mkdtemp(path.join(root, 'workspace-'));
  await writeFile(path.join(workspace, '.zigversion'), '0.17.0');
  assert.equal(await readVersionFile(workspace, '.zigversion'), '0.17.0');
  await assert.rejects(
    readVersionFile(workspace, '../external'),
    /inside the workspace/,
  );
  if (process.platform !== 'win32') {
    await symlink(external, path.join(workspace, 'linked'));
    await assert.rejects(
      readVersionFile(workspace, 'linked'),
      /inside the workspace/,
    );
  }
});
