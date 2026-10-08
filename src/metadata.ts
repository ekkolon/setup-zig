import path from 'node:path';
import * as core from '@actions/core';
import type {CacheStore} from './cache.ts';
import {getText, parseHttpsUrl, type TextResponse} from './http.ts';
import {getErrorMessage, isRecord, readJson, writeJson} from './util.ts';

export const INDEX_URL = 'https://ziglang.org/download/index.json';
export const MIRRORS_URL = 'https://ziglang.org/download/community-mirrors.txt';

interface MetadataSnapshot {
  url: string;
  body: string;
  fetchedAt: number;
  etag?: string;
  modified?: string;
}

interface MetadataOptions<T> {
  name: string;
  url: string;
  ttlMs: number;
  root: string;
  cache: CacheStore;
  parse: (body: string) => T;
  forceRefresh?: boolean;
  onWarning?: (message: string) => void;
  /** Maximum age allowed after a failed refresh; disabled when omitted. */
  maxStaleAgeMs?: number;
  now?: number;
  fetchText?: (
    url: string,
    headers: Record<string, string>,
  ) => Promise<TextResponse>;
}

function isSnapshot(
  value: unknown,
  url: string,
  now: number,
): value is MetadataSnapshot {
  return (
    isRecord(value) &&
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

async function readSnapshot<T>(
  file: string,
  options: MetadataOptions<T>,
  now: number,
): Promise<MetadataSnapshot | undefined> {
  try {
    const data = await readJson(file);
    if (isSnapshot(data, options.url, now)) {
      options.parse(data.body);
      return data;
    }
  } catch {
    // Missing and invalid caches are misses.
  }
  return undefined;
}

/** Reuses valid metadata within its TTL, then refreshes conditionally. */
export async function readCachedMetadata<T>(
  options: MetadataOptions<T>,
): Promise<T> {
  const now = options.now ?? Date.now();
  const file = path.join(options.root, 'metadata', `${options.name}.json`);
  // Time buckets allow refreshes without rewriting immutable Actions caches.
  const prefix = `setup-zig-metadata-v1-${options.name}-`;
  const key = `${prefix}${Math.floor(now / options.ttlMs)}-end`;
  let saved = await readSnapshot(file, options, now);
  if (!saved) {
    await options.cache.restore([file], key, [prefix]);
    saved = await readSnapshot(file, options, now);
  }
  if (saved && !options.forceRefresh && now - saved.fetchedAt < options.ttlMs) {
    return options.parse(saved.body);
  }

  const headers: Record<string, string> = {};
  if (saved?.etag) {
    headers['If-None-Match'] = saved.etag;
  }
  if (saved?.modified) {
    headers['If-Modified-Since'] = saved.modified;
  }
  try {
    const response = await (options.fetchText ?? getText)(options.url, headers);
    if (response.status !== 200 && !(response.status === 304 && saved)) {
      throw new Error('Unexpected metadata response.');
    }
    const body = response.status === 304 && saved ? saved.body : response.body;
    const result = options.parse(body);
    const next: MetadataSnapshot = {url: options.url, fetchedAt: now, body};
    // A 200 replaces validators; only a 304 can reuse the previous ones.
    const etag =
      response.etag ?? (response.status === 304 ? saved?.etag : undefined);
    const modified =
      response.modified ??
      (response.status === 304 ? saved?.modified : undefined);
    if (etag) {
      next.etag = etag;
    }
    if (modified) {
      next.modified = modified;
    }
    await writeJson(file, next);
    await options.cache.save([file], key);
    return result;
  } catch (error) {
    if (
      saved &&
      options.maxStaleAgeMs &&
      now - saved.fetchedAt < options.maxStaleAgeMs
    ) {
      (options.onWarning ?? core.warning)(
        `Could not refresh ${options.name}; using the cached list: ${getErrorMessage(error)}`,
      );
      return options.parse(saved.body);
    }
    throw new Error(
      `Could not fetch Zig ${options.name}: ${getErrorMessage(error)}`,
    );
  }
}

export function parseIndex(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || !isRecord(value.master)) {
    throw new Error('Invalid Zig download index.');
  }
  return value;
}

export function parseMirrorUrl(value: string): string {
  const url = parseHttpsUrl(value);
  if (url.search || /(^|\.)ziglang\.org$/i.test(url.hostname)) {
    throw new Error('Use a community mirror URL without a query string.');
  }
  return url.href.replace(/\/$/, '');
}

export function parseMirrors(text: string): string[] {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => parseMirrorUrl(line.trim()));
  if (lines.length < 1 || lines.length > 100) {
    throw new Error('Invalid community mirror list.');
  }
  return [...new Set(lines)];
}
