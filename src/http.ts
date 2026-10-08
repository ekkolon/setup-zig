import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HttpClient } from '@actions/http-client';

export function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('Download URLs must use HTTPS without credentials or fragments.');
  return url;
}

function client(timeout: number, signal: AbortSignal): HttpClient {
  return new HttpClient(
    'ekkolon/setup-zig',
    [
      {
        prepareRequest(options) {
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
      socketTimeout: timeout,
    },
  );
}

export type TextResponse = { status: number; body: string; etag?: string; modified?: string };

export async function getText(
  url: string,
  headers: Record<string, string> = {},
): Promise<TextResponse> {
  httpsUrl(url);
  const http = client(30_000, AbortSignal.timeout(45_000));
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
    const result: TextResponse = { status, body: Buffer.concat(chunks).toString('utf8') };
    if (response.message.headers.etag) result.etag = response.message.headers.etag;
    if (response.message.headers['last-modified'])
      result.modified = response.message.headers['last-modified'];
    return result;
  } finally {
    http.dispose();
  }
}

export async function download(url: string, destination: string): Promise<void> {
  httpsUrl(url);
  const signal = AbortSignal.timeout(180_000);
  const http = client(30_000, signal);
  try {
    const response = await http.get(url);
    if (response.message.statusCode !== 200) {
      response.message.destroy();
      throw new Error(`HTTP ${response.message.statusCode} from ${new URL(url).host}.`);
    }
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(
          size > 512 * 1024 * 1024 ? new Error('Zig archive exceeds 512 MiB.') : null,
          chunk,
        );
      },
    });
    await pipeline(
      response.message,
      limit,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
      { signal },
    );
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  } finally {
    http.dispose();
  }
}
