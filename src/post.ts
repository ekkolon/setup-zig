import path from 'node:path';
import * as core from '@actions/core';
import {type BuildCacheState, saveBuildCache} from './build_cache.ts';
import {createCacheStore} from './cache.ts';
import {getErrorMessage, isRecord} from './util.ts';

function isBuildCacheState(value: unknown): value is BuildCacheState {
  return (
    isRecord(value) &&
    typeof value.directory === 'string' &&
    typeof value.key === 'string' &&
    typeof value.maxBytes === 'number' &&
    Number.isSafeInteger(value.maxBytes) &&
    value.maxBytes >= 1 &&
    typeof value.readOnly === 'boolean' &&
    (value.hit === undefined || typeof value.hit === 'string')
  );
}

async function run(): Promise<void> {
  const saved = core.getState('build-cache');
  if (!saved) {
    return;
  }
  const state: unknown = JSON.parse(saved);
  if (!isBuildCacheState(state)) {
    throw new Error('Invalid build cache state.');
  }
  const root = path.join(process.env.RUNNER_TEMP ?? '', 'setup-zig-v1');
  await saveBuildCache(state, root, createCacheStore(true, state.readOnly));
}

run().catch((error) =>
  core.warning(`Could not save Zig cache: ${getErrorMessage(error)}`),
);
