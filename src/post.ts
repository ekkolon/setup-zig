import path from 'node:path';
import * as core from '@actions/core';
import { type BuildState, saveBuildCache } from './build-cache.ts';
import { cacheStore } from './cache.ts';
import { message, record } from './util.ts';

async function run(): Promise<void> {
  const saved = core.getState('build-cache');
  if (!saved) return;
  const state: unknown = JSON.parse(saved);
  if (
    !record(state) ||
    typeof state.directory !== 'string' ||
    typeof state.key !== 'string' ||
    typeof state.maxBytes !== 'number' ||
    !Number.isSafeInteger(state.maxBytes) ||
    state.maxBytes < 1 ||
    typeof state.readOnly !== 'boolean' ||
    (state.hit !== undefined && typeof state.hit !== 'string')
  )
    throw new Error('Invalid build cache state.');
  const root = path.join(process.env.RUNNER_TEMP ?? '', 'setup-zig-v1');
  await saveBuildCache(state as BuildState, root, cacheStore(true, state.readOnly));
}

run().catch((error) => core.warning(`Could not save Zig cache: ${message(error)}`));
