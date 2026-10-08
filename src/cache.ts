import * as cache from '@actions/cache';
import * as core from '@actions/core';
import { message } from './util.ts';

export interface CacheStore {
  restore(paths: string[], key: string, prefixes?: string[]): Promise<string | undefined>;
  save(paths: string[], key: string): Promise<void>;
}

export function cacheStore(enabled: boolean, readOnly: boolean): CacheStore {
  const available = enabled && cache.isFeatureAvailable();
  if (enabled && !available)
    core.info('Actions cache is unavailable; continuing without remote caching.');
  return {
    async restore(paths, key, prefixes = []) {
      if (!available) return undefined;
      try {
        return await cache.restoreCache(paths, key, prefixes, { segmentTimeoutInMs: 60_000 });
      } catch (error) {
        core.warning(`Could not restore cache: ${message(error)}`);
        return undefined;
      }
    },
    async save(paths, key) {
      if (!available || readOnly) return;
      try {
        await cache.saveCache(paths, key);
      } catch (error) {
        // Concurrent matrix jobs can reserve the same immutable key.
        core.warning(`Could not save cache: ${message(error)}`);
      }
    },
  };
}
