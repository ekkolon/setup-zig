import {lstat, mkdir, readdir, realpath} from 'node:fs/promises';
import path from 'node:path';
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import type {CacheStore} from './cache.ts';
import {hashString, isPathInside} from './util.ts';

/** Limits fallback restores to the same platform, compiler build, and scope. */
export function getBuildCacheKeys(
  version: string,
  target: string,
  scope: string,
  dependencies: string,
  commit: string,
): {primary: string; prefix: string} {
  const prefix = `setup-zig-build-v1-${hashString(`${target}\n${version}\n${scope}`)}-`;
  return {
    primary: `${prefix}${hashString(`${dependencies}\n${commit}`)}-end`,
    prefix,
  };
}

export interface BuildCacheState {
  directory: string;
  key: string;
  hit?: string;
  maxBytes: number;
  readOnly: boolean;
}

interface BuildCacheOptions {
  root: string;
  version: string;
  target: string;
  scope: string;
  dependencyPath: string;
  workspace: string;
  maxBytes: number;
  readOnly: boolean;
  cache: CacheStore;
}

export async function restoreBuildCache(
  options: BuildCacheOptions,
): Promise<{directory: string; hit: boolean}> {
  const {root, version, target, scope} = options;
  const directory = path.join(
    root,
    'build',
    hashString(`${version}\n${target}\n${scope}`),
  );
  await mkdir(directory, {recursive: true});
  const patterns = options.dependencyPath || '**/build.zig.zon';
  const globber = await glob.create(patterns, {
    followSymbolicLinks: false,
    implicitDescendants: false,
  });
  const files = await globber.glob();
  const workspace = await realpath(options.workspace);
  for (const file of files) {
    if (!isPathInside(workspace, await realpath(file))) {
      throw new Error(
        'cache-dependency-path must match files inside the workspace.',
      );
    }
  }
  if (options.dependencyPath && files.length === 0) {
    throw new Error('cache-dependency-path did not match any files.');
  }
  const dependencies = await glob.hashFiles(patterns, options.workspace, {
    followSymbolicLinks: false,
  });
  const keys = getBuildCacheKeys(
    version,
    target,
    scope,
    dependencies,
    process.env.GITHUB_SHA ?? 'local',
  );
  const hit = await options.cache.restore([directory], keys.primary, [
    keys.prefix,
  ]);
  const state: BuildCacheState = {
    directory,
    key: keys.primary,
    maxBytes: options.maxBytes,
    readOnly: options.readOnly,
  };
  if (hit) {
    state.hit = hit;
  }
  core.saveState('build-cache', JSON.stringify(state));
  core.exportVariable('ZIG_GLOBAL_CACHE_DIR', directory);
  return {directory, hit: hit === keys.primary};
}

/** Stops above the limit and rejects links or special files before upload. */
export async function getDirectorySize(
  directory: string,
  limit: number,
): Promise<number> {
  let size = 0;
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error('Zig cache contains a symbolic link; skipping upload.');
    }
    if (entry.isDirectory()) {
      size += await getDirectorySize(file, limit - size);
    } else if (entry.isFile()) {
      size += (await lstat(file)).size;
    } else {
      throw new Error('Zig cache contains a special file; skipping upload.');
    }
    if (size > limit) {
      return size;
    }
  }
  return size;
}

export async function saveBuildCache(
  state: BuildCacheState,
  root: string,
  cache: CacheStore,
): Promise<void> {
  if (state.readOnly || state.hit === state.key) {
    return;
  }
  const expectedRoot = path.join(await realpath(root), 'build');
  const directory = await realpath(state.directory);
  if (
    !isPathInside(expectedRoot, directory) ||
    !(await lstat(state.directory)).isDirectory()
  ) {
    throw new Error('Unexpected Zig cache path.');
  }
  const size = await getDirectorySize(directory, state.maxBytes);
  if (size === 0) {
    return;
  }
  if (size > state.maxBytes) {
    core.info('Zig cache exceeds cache-size-limit; skipping upload.');
    return;
  }
  await cache.save([state.directory], state.key);
}
