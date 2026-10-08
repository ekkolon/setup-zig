import path from 'node:path';
import * as core from '@actions/core';
import { restoreBuildCache } from './build-cache.ts';
import { cacheStore } from './cache.ts';
import { install } from './install.ts';
import {
  INDEX_URL,
  MIRRORS_URL,
  metadata,
  mirrorUrl,
  parseIndex,
  parseMirrors,
} from './metadata.ts';
import { message } from './util.ts';
import {
  filenames,
  parseRequest,
  platform,
  type Release,
  readVersionFile,
  resolveIndex,
} from './version.ts';

export async function run(): Promise<void> {
  const temporary = process.env.RUNNER_TEMP;
  if (!temporary) throw new Error('RUNNER_TEMP is not set. Run setup-zig in a GitHub Actions job.');
  const root = path.join(temporary, 'setup-zig-v1');
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const versionInput = core.getInput('version');
  const versionFile = core.getInput('version-file');
  if (versionInput && versionFile) core.warning('version takes precedence over version-file.');
  const request = parseRequest(
    versionInput || (versionFile ? await readVersionFile(workspace, versionFile) : 'latest'),
  );
  const target = platform(process.platform, core.getInput('architecture') || process.arch);
  const checksum = core.getInput('checksum').toLowerCase();
  if (checksum && !/^[a-f0-9]{64}$/.test(checksum))
    throw new Error('checksum must be a SHA-256 digest (64 hexadecimal characters).');
  const customMirror = core.getInput('mirror');
  const mirror = customMirror ? mirrorUrl(customMirror) : '';
  const readOnly = core.getBooleanInput('cache-read-only');
  const toolCache = cacheStore(core.getBooleanInput('cache-toolchain'), readOnly);
  const useBuildCache = core.getBooleanInput('cache');
  const maxMiB = Number(core.getInput('cache-size-limit'));
  if (!Number.isSafeInteger(maxMiB) || maxMiB < 1 || maxMiB > 10240)
    throw new Error('cache-size-limit must be between 1 and 10240 MiB.');
  let release: Release;
  if (request.kind === 'exact')
    release = { version: request.value, filenames: filenames(request.value, target) };
  else {
    const index = await metadata({
      name: 'index',
      url: INDEX_URL,
      ttl: 60 * 60 * 1000,
      root,
      cache: toolCache,
      parse: parseIndex,
      fresh: core.getBooleanInput('check-latest'),
    });
    release = resolveIndex(index, request, target);
  }
  if (checksum) {
    if (release.sha256 && checksum !== release.sha256)
      throw new Error('checksum does not match the Zig download index.');
    release.sha256 = checksum;
  }
  const installed = await install({
    root,
    release,
    target,
    cache: toolCache,
    mirrors: async () =>
      mirror
        ? [mirror]
        : metadata({
            name: 'mirrors',
            url: MIRRORS_URL,
            ttl: 24 * 60 * 60 * 1000,
            staleFor: 7 * 24 * 60 * 60 * 1000,
            root,
            cache: toolCache,
            parse: parseMirrors,
          }),
  });
  let cacheHit = false;
  let globalCache = process.env.ZIG_GLOBAL_CACHE_DIR ?? '';
  if (useBuildCache) {
    const restored = await restoreBuildCache({
      root,
      version: release.version,
      target: `${target.os}-${target.arch}`,
      scope: core.getInput('cache-key'),
      dependencyPath: core.getInput('cache-dependency-path'),
      workspace,
      maxBytes: maxMiB * 1024 * 1024,
      readOnly,
      cache: cacheStore(true, readOnly),
    });
    cacheHit = restored.hit;
    globalCache = restored.directory;
  }
  core.addPath(installed.directory);
  core.setOutput('version', release.version);
  core.setOutput('zig-path', installed.directory);
  core.setOutput('cache-hit', cacheHit);
  core.setOutput('toolchain-cache-hit', installed.source !== 'download');
  core.setOutput('global-cache-dir', globalCache);
  core.setOutput('sha256', installed.sha256);
  core.info(`Zig ${release.version} is ready (${target.os}/${target.arch}, ${installed.source}).`);
}

run().catch((error) => core.setFailed(message(error)));
