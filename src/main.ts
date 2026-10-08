import path from 'node:path';
import * as core from '@actions/core';
import {restoreBuildCache} from './build_cache.ts';
import {createCacheStore} from './cache.ts';
import {installZig} from './install.ts';
import {
  INDEX_URL,
  MIRRORS_URL,
  parseIndex,
  parseMirrors,
  parseMirrorUrl,
  readCachedMetadata,
} from './metadata.ts';
import {getErrorMessage} from './util.ts';
import {
  getArchiveFilenames,
  parseVersionRequest,
  type Release,
  readVersionFile,
  resolvePlatform,
  resolveReleaseFromIndex,
} from './version.ts';

async function run(): Promise<void> {
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) {
    throw new Error(
      'RUNNER_TEMP is not set. Run setup-zig in a GitHub Actions job.',
    );
  }
  const root = path.join(runnerTemp, 'setup-zig-v1');
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

  let versionInput = core.getInput('version');
  const versionFile = core.getInput('version-file');
  if (versionInput && versionFile) {
    core.warning('version takes precedence over version-file.');
  }
  if (!versionInput) {
    versionInput = versionFile
      ? await readVersionFile(workspace, versionFile)
      : 'latest';
  }
  const request = parseVersionRequest(versionInput);
  const target = resolvePlatform(
    process.platform,
    core.getInput('architecture') || process.arch,
  );
  const checksum = core.getInput('checksum').toLowerCase();
  if (checksum && !/^[a-f0-9]{64}$/.test(checksum)) {
    throw new Error(
      'checksum must be a SHA-256 digest (64 hexadecimal characters).',
    );
  }
  const customMirror = core.getInput('mirror');
  const mirror = customMirror ? parseMirrorUrl(customMirror) : '';
  const readOnly = core.getBooleanInput('cache-read-only');
  const toolchainCache = createCacheStore(
    core.getBooleanInput('cache-toolchain'),
    readOnly,
  );
  const useBuildCache = core.getBooleanInput('cache');
  const cacheSizeLimitMib = Number(core.getInput('cache-size-limit'));
  if (
    !Number.isSafeInteger(cacheSizeLimitMib) ||
    cacheSizeLimitMib < 1 ||
    cacheSizeLimitMib > 10240
  ) {
    throw new Error('cache-size-limit must be between 1 and 10240 MiB.');
  }

  let release: Release;
  if (request.kind === 'exact') {
    release = {
      version: request.value,
      filenames: getArchiveFilenames(request.value, target),
    };
  } else {
    const index = await readCachedMetadata({
      name: 'index',
      url: INDEX_URL,
      ttlMs: 60 * 60 * 1000,
      root,
      cache: toolchainCache,
      parse: parseIndex,
      forceRefresh: core.getBooleanInput('check-latest'),
    });
    release = resolveReleaseFromIndex(index, request, target);
  }
  if (checksum) {
    if (release.sha256 && checksum !== release.sha256) {
      throw new Error('checksum does not match the Zig download index.');
    }
    release.sha256 = checksum;
  }
  const installation = await installZig({
    root,
    release,
    target,
    cache: toolchainCache,
    getMirrors: async () => {
      if (mirror) {
        return [mirror];
      }
      return readCachedMetadata({
        name: 'mirrors',
        url: MIRRORS_URL,
        ttlMs: 24 * 60 * 60 * 1000,
        maxStaleAgeMs: 7 * 24 * 60 * 60 * 1000,
        root,
        cache: toolchainCache,
        parse: parseMirrors,
      });
    },
  });

  let cacheHit = false;
  let globalCacheDirectory = process.env.ZIG_GLOBAL_CACHE_DIR ?? '';
  if (useBuildCache) {
    const restored = await restoreBuildCache({
      root,
      version: release.version,
      target: `${target.os}-${target.arch}`,
      scope: core.getInput('cache-key'),
      dependencyPath: core.getInput('cache-dependency-path'),
      workspace,
      maxBytes: cacheSizeLimitMib * 1024 * 1024,
      readOnly,
      cache: createCacheStore(true, readOnly),
    });
    cacheHit = restored.hit;
    globalCacheDirectory = restored.directory;
  }

  core.addPath(installation.directory);
  core.setOutput('version', release.version);
  core.setOutput('zig-path', installation.directory);
  core.setOutput('cache-hit', cacheHit);
  core.setOutput('toolchain-cache-hit', installation.source !== 'download');
  core.setOutput('global-cache-dir', globalCacheDirectory);
  core.setOutput('sha256', installation.sha256);
  core.info(
    `Zig ${release.version} is ready (${target.os}/${target.arch}, ${installation.source}).`,
  );
}

run().catch((error) => core.setFailed(getErrorMessage(error)));
