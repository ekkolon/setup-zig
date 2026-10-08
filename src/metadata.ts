import path from 'node:path';
import * as core from '@actions/core';
import type { CacheStore } from './cache.ts';
import { getText, httpsUrl, type TextResponse } from './http.ts';
import { message, readJson, record, writeJson } from './util.ts';

export const INDEX_URL = 'https://ziglang.org/download/index.json';
export const MIRRORS_URL = 'https://ziglang.org/download/community-mirrors.txt';
type Snapshot = { url: string; body: string; fetchedAt: number; etag?: string; modified?: string };

function snapshot(value: unknown, url: string, now: number): value is Snapshot {
  return (
    record(value) &&
    value.url === url &&
    typeof value.body === 'string' &&
    value.body.length <= 1024 * 1024 &&
    typeof value.fetchedAt === 'number' &&
    value.fetchedAt > 0 &&
    value.fetchedAt <= now &&
    (value.etag === undefined || typeof value.etag === 'string') &&
    (value.modified === undefined || typeof value.modified === 'string')
  );
}

export async function metadata<T>(options: {
  name: string;
  url: string;
  ttl: number;
  root: string;
  cache: CacheStore;
  parse: (body: string) => T;
  fresh?: boolean;
  staleFor?: number;
  now?: number;
  fetch?: (url: string, headers: Record<string, string>) => Promise<TextResponse>;
}): Promise<T> {
  const now = options.now ?? Date.now();
  const file = path.join(options.root, 'metadata', `${options.name}.json`);
  const prefix = `setup-zig-metadata-v1-${options.name}-`;
  const key = `${prefix}${Math.floor(now / options.ttl)}-end`;
  let saved: Snapshot | undefined;
  const load = async () => {
    try {
      const data = await readJson(file);
      if (snapshot(data, options.url, now)) {
        options.parse(data.body);
        return data;
      }
    } catch {
      /* Missing and invalid caches are misses. */
    }
    return undefined;
  };
  saved = await load();
  if (!saved) {
    await options.cache.restore([file], key, [prefix]);
    saved = await load();
  }
  if (saved && !options.fresh && now - saved.fetchedAt < options.ttl)
    return options.parse(saved.body);
  const headers: Record<string, string> = {};
  if (saved?.etag) headers['If-None-Match'] = saved.etag;
  if (saved?.modified) headers['If-Modified-Since'] = saved.modified;
  try {
    const response = await (options.fetch ?? getText)(options.url, headers);
    if (response.status !== 200 && !(response.status === 304 && saved))
      throw new Error('Unexpected metadata response.');
    const body = response.status === 304 && saved ? saved.body : response.body;
    const result = options.parse(body);
    const next: Snapshot = { url: options.url, fetchedAt: now, body };
    const etag = response.etag ?? saved?.etag;
    const modified = response.modified ?? saved?.modified;
    if (etag) next.etag = etag;
    if (modified) next.modified = modified;
    await writeJson(file, next);
    await options.cache.save([file], key);
    return result;
  } catch (error) {
    if (saved && options.staleFor && now - saved.fetchedAt < options.staleFor) {
      core.warning(`Could not refresh ${options.name}; using the cached list: ${message(error)}`);
      return options.parse(saved.body);
    }
    throw new Error(`Could not fetch Zig ${options.name}: ${message(error)}`);
  }
}

export function parseIndex(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!record(value) || !record(value.master)) throw new Error('Invalid Zig download index.');
  return value;
}

export function mirrorUrl(value: string): string {
  const url = httpsUrl(value);
  if (url.search || /(^|\.)ziglang\.org$/i.test(url.hostname))
    throw new Error('Use a community mirror URL without a query string.');
  return url.href.replace(/\/$/, '');
}

export function parseMirrors(text: string): string[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => mirrorUrl(line.trim()));
  if (lines.length < 1 || lines.length > 100) throw new Error('Invalid community mirror list.');
  return [...new Set(lines)];
}
