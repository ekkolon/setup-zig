import {createWriteStream} from 'node:fs';
import {rm} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {HttpClient} from '@actions/http-client';

export function parseHttpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error(
      'Download URLs must use HTTPS without credentials or fragments.',
    );
  }
  return url;
}

function createHttpClient(signal: AbortSignal): HttpClient {
  return new HttpClient(
    'ekkolon/setup-zig',
    [
      {
        prepareRequest(options) {
          // The socket timeout alone does not bound the complete download.
          options.signal = signal;
        },
        canHandleAuthentication() {
          return false;
        },
        async handleAuthentication() {
          throw new Error('Download authentication is not supported.');
        },
      },
    ],
    {
      allowRetries: false,
      allowRedirectDowngrade: false,
      maxRedirects: 5,
      socketTimeout: 30_000,
    },
  );
}

export interface TextResponse {
  status: number;
  body: string;
  etag?: string;
  modified?: string;
}

export async function getText(
  url: string,
  headers: Record<string, string> = {},
): Promise<TextResponse> {
  parseHttpsUrl(url);
  const http = createHttpClient(AbortSignal.timeout(45_000));
  try {
    const response = await http.get(url, headers);
    const status = response.message.statusCode ?? 0;
    if (status !== 200 && status !== 304) {
      response.message.destroy();
      throw new Error(`HTTP ${status} from ${new URL(url).host}.`);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.message) {
      size += chunk.length;
      if (size > 1024 * 1024) {
        response.message.destroy();
        throw new Error('Download metadata exceeds 1 MiB.');
      }
      chunks.push(Buffer.from(chunk));
    }
    const result: TextResponse = {
      status,
      body: Buffer.concat(chunks).toString('utf8'),
    };
    if (response.message.headers.etag) {
      result.etag = response.message.headers.etag;
    }
    if (response.message.headers['last-modified']) {
      result.modified = response.message.headers['last-modified'];
    }
    return result;
  } finally {
    http.dispose();
  }
}

async function* limitArchiveSize(source: AsyncIterable<Buffer>) {
  let size = 0;
  for await (const chunk of source) {
    size += chunk.length;
    if (size > 512 * 1024 * 1024) {
      throw new Error('Zig archive exceeds 512 MiB.');
    }
    yield chunk;
  }
}

export async function download(
  url: string,
  destination: string,
): Promise<void> {
  parseHttpsUrl(url);
  const signal = AbortSignal.timeout(180_000);
  const http = createHttpClient(signal);
  try {
    const response = await http.get(url);
    if (response.message.statusCode !== 200) {
      response.message.destroy();
      throw new Error(
        `HTTP ${response.message.statusCode} from ${new URL(url).host}.`,
      );
    }
    await pipeline(
      response.message,
      limitArchiveSize,
      createWriteStream(destination, {flags: 'wx', mode: 0o600}),
      {signal},
    );
  } catch (error) {
    await rm(destination, {force: true});
    throw error;
  } finally {
    http.dispose();
  }
}
