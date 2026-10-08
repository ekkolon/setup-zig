import { lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import * as core from '@actions/core';
import * as glob from '@actions/glob';
import type { CacheStore } from './cache.ts';
import { digest, inside } from './util.ts';

export function buildKeys(
  version: string,
  target: string,
  scope: string,
  dependencies: string,
  commit: string,
) {
  const prefix = `setup-zig-build-v1-${digest(`${target}\n${version}\n${scope}`)}-`;
  return { primary: `${prefix}${digest(`${dependencies}\n${commit}`)}-end`, prefix };
}

export type BuildState = {
  directory: string;
  key: string;
  hit?: string;
  maxBytes: number;
  readOnly: boolean;
};

export async function restoreBuildCache(options: {
  root: string;
  version: string;
  target: string;
  scope: string;
  dependencyPath: string;
  workspace: string;
  maxBytes: number;
  readOnly: boolean;
  cache: CacheStore;
}): Promise<{ directory: string; hit: boolean }> {
  const { root, version, target, scope } = options;
  const directory = path.join(root, 'build', digest(`${version}\n${target}\n${scope}`));
  await mkdir(directory, { recursive: true });
  const patterns = options.dependencyPath || '**/build.zig.zon';
  const hasher = await glob.create(patterns, {
    followSymbolicLinks: false,
    implicitDescendants: false,
  });
  const files = await hasher.glob();
  const workspace = await realpath(options.workspace);
  for (const file of files) {
    if (!inside(workspace, await realpath(file)))
      throw new Error('cache-dependency-path must match files inside the workspace.');
  }
  if (options.dependencyPath && files.length === 0)
    throw new Error('cache-dependency-path did not match any files.');
  const dependencies = await glob.hashFiles(patterns, options.workspace, {
    followSymbolicLinks: false,
  });
  const keys = buildKeys(version, target, scope, dependencies, process.env.GITHUB_SHA ?? 'local');
  const hit = await options.cache.restore([directory], keys.primary, [keys.prefix]);
  const state: BuildState = {
    directory,
    key: keys.primary,
    maxBytes: options.maxBytes,
    readOnly: options.readOnly,
  };
  if (hit) state.hit = hit;
  core.saveState('build-cache', JSON.stringify(state));
  core.exportVariable('ZIG_GLOBAL_CACHE_DIR', directory);
  return { directory, hit: hit === keys.primary };
}

export async function directorySize(directory: string, limit: number): Promise<number> {
  let size = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error('Zig cache contains a symbolic link; skipping upload.');
    if (entry.isDirectory()) size += await directorySize(file, limit - size);
    else if (entry.isFile()) size += (await lstat(file)).size;
    else throw new Error('Zig cache contains a special file; skipping upload.');
    if (size > limit) return size;
  }
  return size;
}

export async function saveBuildCache(
  state: BuildState,
  root: string,
  cache: CacheStore,
): Promise<void> {
  if (state.readOnly || state.hit === state.key) return;
  const expectedRoot = path.join(await realpath(root), 'build');
  const directory = await realpath(state.directory);
  if (!inside(expectedRoot, directory) || !(await lstat(state.directory)).isDirectory())
    throw new Error('Unexpected Zig cache path.');
  const size = await directorySize(directory, state.maxBytes);
  if (size === 0) return;
  if (size > state.maxBytes) {
    core.info('Zig cache exceeds cache-size-limit; skipping upload.');
    return;
  }
  await cache.save([state.directory], state.key);
}
