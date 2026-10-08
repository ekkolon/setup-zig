import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {
  getBuildCacheKeys,
  getDirectorySize,
  saveBuildCache,
} from '../src/build_cache.ts';
import type {CacheStore} from '../src/cache.ts';
import {parseHttpsUrl} from '../src/http.ts';
import {
  getArchiveCacheKey,
  getArtifactUrl,
  installZig,
  shuffle,
} from '../src/install.ts';
import {
  parseIndex,
  parseMirrors,
  parseMirrorUrl,
  readCachedMetadata,
} from '../src/metadata.ts';
import {writeJson} from '../src/util.ts';

function memoryCache() {
  const saved: string[] = [];
  const store: CacheStore = {
    restore: async () => undefined,
    save: async (...[, key]) => {
      saved.push(key);
    },
  };
  return {store, saved};
}

test('metadata is reused within its TTL and refreshed conditionally', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-zig-metadata-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const {store, saved} = memoryCache();
  let requests = 0;
  const options = {
    root,
    cache: store,
    name: 'test',
    url: 'https://example.com/index',
    ttlMs: 1000,
    now: 5000,
    parse: JSON.parse,
    fetchText: async (url: string, headers: Record<string, string>) => {
      assert.equal(url, 'https://example.com/index');
      requests++;
      if (requests === 1) {
        return {status: 200, body: '{"version":"0.17.0"}', etag: '"v1"'};
      }
      assert.equal(headers['If-None-Match'], '"v1"');
      return {status: 304, body: ''};
    },
  };
  assert.deepEqual(await readCachedMetadata(options), {version: '0.17.0'});
  await readCachedMetadata({...options, now: 5500});
  assert.equal(requests, 1);
  await readCachedMetadata({...options, now: 6500});
  assert.equal(requests, 2);
  assert.equal(saved.length, 2);
  assert.notEqual(saved[0], saved[1]);
});

test('check-latest refreshes fresh metadata while respecting HTTP validators', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-zig-fresh-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  await writeJson(path.join(root, 'metadata', 'index.json'), {
    url: 'https://example.com/index',
    body: '{}',
    fetchedAt: 4900,
    etag: '"v1"',
  });
  let requests = 0;
  await readCachedMetadata({
    root,
    cache: memoryCache().store,
    name: 'index',
    url: 'https://example.com/index',
    ttlMs: 1000,
    now: 5000,
    forceRefresh: true,
    parse: JSON.parse,
    fetchText: async (url, headers) => {
      assert.equal(url, 'https://example.com/index');
      requests++;
      assert.equal(headers['If-None-Match'], '"v1"');
      return {status: 304, body: ''};
    },
  });
  assert.equal(requests, 1);
});

test('a remote metadata hit avoids contacting ziglang.org', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-zig-remote-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const cache: CacheStore = {
    restore: async (paths, key) => {
      await writeJson(paths[0] ?? '', {
        url: 'https://example.com/index',
        body: '{}',
        fetchedAt: 4900,
      });
      return key;
    },
    save: async () => assert.fail('unexpected save'),
  };
  await readCachedMetadata({
    root,
    cache,
    name: 'index',
    url: 'https://example.com/index',
    ttlMs: 1000,
    now: 5000,
    parse: JSON.parse,
    fetchText: async () => assert.fail('unexpected origin request'),
  });
});

test('expired version metadata fails closed; mirrors have a bounded stale fallback', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-zig-stale-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const options = {
    root,
    cache: memoryCache().store,
    name: 'index',
    url: 'https://example.com/index',
    ttlMs: 1000,
    now: 5000,
    parse: JSON.parse,
    fetchText: async () => {
      throw new Error('HTTP 429');
    },
  };
  await writeJson(path.join(root, 'metadata', 'index.json'), {
    url: options.url,
    body: '{}',
    fetchedAt: 2000,
  });
  await assert.rejects(readCachedMetadata(options), /HTTP 429/);
  assert.deepEqual(
    await readCachedMetadata({...options, maxStaleAgeMs: 4000}),
    {},
  );
  await assert.rejects(
    readCachedMetadata({...options, maxStaleAgeMs: 2000}),
    /HTTP 429/,
  );
});

test('malformed, future-dated, and wrong-origin metadata cannot suppress a refresh', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-zig-invalid-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  for (const snapshot of [
    {url: 'https://example.com/index', body: '{}', fetchedAt: 9000},
    {url: 'https://evil.example', body: '{}', fetchedAt: 4000},
    {url: 'https://example.com/index', body: '{bad', fetchedAt: 4000},
  ]) {
    await writeJson(path.join(root, 'metadata', 'index.json'), snapshot);
    let requests = 0;
    await readCachedMetadata({
      root,
      cache: memoryCache().store,
      name: 'index',
      url: 'https://example.com/index',
      ttlMs: 10000,
      now: 5000,
      parse: JSON.parse,
      fetchText: async () => {
        requests++;
        return {status: 200, body: '{}'};
      },
    });
    assert.equal(requests, 1);
  }
});

test('HTTPS validation and mirror URLs reject unsafe configuration', () => {
  for (const url of [
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com/#x',
  ]) {
    assert.throws(() => parseHttpsUrl(url));
  }
  for (const url of [
    'https://ziglang.org/download',
    'https://example.com/?x=1',
    'https://www.ziglang.org',
  ]) {
    assert.throws(() => parseMirrorUrl(url));
  }
  assert.equal(
    parseMirrorUrl('https://example.com/zig/'),
    'https://example.com/zig',
  );
  assert.deepEqual(
    parseMirrors(
      'https://a.example/zig\nhttps://a.example/zig\nhttps://b.example\n',
    ),
    ['https://a.example/zig', 'https://b.example'],
  );
  assert.throws(() => parseIndex('[]'));
  assert.throws(() => parseIndex('{}'));
  assert.throws(() => parseMirrors(''));
  assert.equal(
    new URL(
      getArtifactUrl('https://example.com/zig', 'zig.tar.xz'),
    ).searchParams.get('source'),
    'github-ekkolon-setup-zig',
  );
});

test('cache keys isolate compiler builds, platforms, projects, and dependencies', () => {
  const key = getBuildCacheKeys(
    '0.17.0',
    'linux-x86_64',
    'project-a',
    'deps-a',
    'commit-a',
  );
  assert.notEqual(
    key.primary,
    getBuildCacheKeys(
      '0.17.0',
      'linux-x86_64',
      'project-a',
      'deps-b',
      'commit-a',
    ).primary,
  );
  assert.notEqual(
    key.primary,
    getBuildCacheKeys(
      '0.17.0',
      'linux-x86_64',
      'project-a',
      'deps-a',
      'commit-b',
    ).primary,
  );
  assert.notEqual(
    key.prefix,
    getBuildCacheKeys('0.17.0', 'linux-aarch64', 'project-a', '', '').prefix,
  );
  assert.notEqual(
    key.prefix,
    getBuildCacheKeys('0.17.0', 'linux-x86_64', 'project-b', '', '').prefix,
  );
  assert.notEqual(
    key.prefix,
    getBuildCacheKeys(
      '0.18.0-dev.1+aaaaaaa',
      'linux-x86_64',
      'project-a',
      '',
      '',
    ).prefix,
  );
  assert.notEqual(
    getArchiveCacheKey('zig-x86_64-linux-0.18.0-dev.1+aaaaaaa.tar.xz'),
    getArchiveCacheKey('zig-x86_64-linux-0.18.0-dev.1+bbbbbbb.tar.xz'),
  );
});

test('shuffling mirrors preserves every distinct entry and leaves the input unchanged', () => {
  const original = ['a', 'b', 'c', 'd'];
  assert.deepEqual(shuffle(original).sort(), original);
  assert.deepEqual(original, ['a', 'b', 'c', 'd']);
});

test('build caches save once, skip read-only and oversized data, and retain local files', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-zig-build-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const directory = path.join(root, 'build', 'test');
  await mkdir(directory, {recursive: true});
  await writeFile(path.join(directory, 'data'), '0123456789');
  const {store, saved} = memoryCache();
  const state = {directory, key: 'key', maxBytes: 100, readOnly: false};
  await saveBuildCache(state, root, store);
  await saveBuildCache({...state, hit: 'key'}, root, store);
  await saveBuildCache({...state, readOnly: true}, root, store);
  await saveBuildCache({...state, maxBytes: 5}, root, store);
  assert.deepEqual(saved, ['key']);
  assert.equal(await getDirectorySize(directory, 100), 10);
  await assert.rejects(
    saveBuildCache({...state, directory: root}, root, store),
    /Unexpected/,
  );
  if (process.platform !== 'win32') {
    await symlink(path.join(directory, 'data'), path.join(directory, 'link'));
    await assert.rejects(saveBuildCache(state, root, store), /symbolic link/);
  }
});

test('a changed metadata response discards obsolete HTTP validators', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-zig-validator-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const url = 'https://example.com/index';
  await writeJson(path.join(root, 'metadata', 'index.json'), {
    url,
    body: '{}',
    fetchedAt: 4000,
    etag: '"old"',
    modified: 'old-date',
  });
  let requests = 0;
  const options = {
    root,
    url,
    cache: memoryCache().store,
    name: 'index',
    ttlMs: 1000,
    now: 5000,
    forceRefresh: true,
    parse: JSON.parse,
    fetchText: async (url: string, headers: Record<string, string>) => {
      assert.equal(url, 'https://example.com/index');
      if (requests++ === 0) {
        assert.equal(headers['If-None-Match'], '"old"');
      } else {
        assert.deepEqual(headers, {});
      }
      return {status: 200, body: '{"changed":true}'};
    },
  };
  await readCachedMetadata(options);
  await readCachedMetadata({...options, now: 5500});
  assert.equal(requests, 2);
});

for (const cacheResult of ['partial', 'invalid']) {
  test(`cleans a ${cacheResult} archive cache before contacting a mirror`, async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'setup-zig-recovery-'));
    context.after(() => rm(root, {recursive: true, force: true}));
    const previousToolCache = process.env.RUNNER_TOOL_CACHE;
    process.env.RUNNER_TOOL_CACHE = path.join(root, 'tools');
    context.after(() => {
      if (previousToolCache === undefined) {
        delete process.env.RUNNER_TOOL_CACHE;
      } else {
        process.env.RUNNER_TOOL_CACHE = previousToolCache;
      }
    });
    let archiveDirectory = '';
    let saved = false;
    const cache: CacheStore = {
      restore: async (paths, key) => {
        const archive = paths[0] ?? '';
        archiveDirectory = path.dirname(archive);
        await writeFile(archive, 'incomplete archive');
        await writeFile(`${archive}.minisig`, 'invalid signature');
        return cacheResult === 'partial' ? undefined : key;
      },
      save: async () => {
        saved = true;
      },
    };
    await assert.rejects(
      installZig({
        root,
        release: {
          version: '0.17.0',
          filenames: ['zig-x86_64-linux-0.17.0.tar.xz'],
        },
        target: {os: 'linux', arch: 'x86_64'},
        cache,
        getMirrors: async () => {
          assert.deepEqual(await readdir(archiveDirectory), []);
          throw new Error('download boundary reached');
        },
      }),
      /download boundary reached/,
    );
    assert.equal(saved, false);
  });
}
