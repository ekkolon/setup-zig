import { randomInt } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import type { CacheStore } from './cache.ts';
import { download, getText } from './http.ts';
import { parseSignature, verifyArchive, ZIG_PUBLIC_KEY } from './signature.ts';
import { digest, inside, message } from './util.ts';
import { type Platform, type Release, toolVersion } from './version.ts';

export type Installation = {
  directory: string;
  source: 'download' | 'actions-cache' | 'tool-cache';
  sha256: string;
};

export function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const current = result[i];
    const replacement = result[j];
    if (current !== undefined && replacement !== undefined) {
      result[i] = replacement;
      result[j] = current;
    }
  }
  return result;
}

export function archiveKey(filename: string): string {
  return `setup-zig-archive-v1-${digest(`${ZIG_PUBLIC_KEY}\n${filename}`)}-end`;
}

export function artifactUrl(mirror: string, filename: string): string {
  const url = new URL(`${mirror}/${filename}`);
  url.searchParams.set('source', 'github-ekkolon-setup-zig');
  return url.href;
}

export async function downloadArchive(
  directory: string,
  release: Release,
  mirrors: string[],
): Promise<{ filename: string; sha256: string }> {
  const failures: string[] = [];
  for (const mirror of shuffled(mirrors).slice(0, 5)) {
    for (const filename of release.filenames) {
      const archive = path.join(directory, filename);
      const signature = `${archive}.minisig`;
      try {
        core.info(`Downloading ${filename} from ${new URL(mirror).host}`);
        // Reject the wrong signed filename before downloading a large archive.
        const response = await getText(artifactUrl(mirror, `${filename}.minisig`));
        parseSignature(response.body, filename);
        await writeFile(signature, response.body, { mode: 0o600 });
        await download(artifactUrl(mirror, filename), archive);
        const sha256 = await verifyArchive(
          archive,
          signature,
          filename,
          release.sha256,
          release.size,
        );
        return { filename, sha256 };
      } catch (error) {
        failures.push(`${new URL(mirror).host}: ${message(error)}`);
        core.warning(`Mirror failed: ${failures.at(-1)}`);
        await rm(archive, { force: true });
        await rm(signature, { force: true });
      }
    }
  }
  throw new Error(
    `Could not download verified Zig ${release.version}. Older development builds may no longer be available. Try again or set mirror to an available HTTPS mirror.\n${failures.join('\n')}`,
  );
}

export async function install(options: {
  root: string;
  release: Release;
  target: Platform;
  cache: CacheStore;
  mirrors: () => Promise<string[]>;
}): Promise<Installation> {
  const { root, release, target } = options;
  const id = digest(`${target.os}/${target.arch}/${release.version}`);
  const directory = path.join(root, 'archives', id);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  let source: Installation['source'] = 'download';
  let found: { filename: string; sha256: string } | undefined;
  const tool = `zig-archive-v1-${digest(ZIG_PUBLIC_KEY).slice(0, 16)}`;
  const arch = `${target.os}-${target.arch}`;
  const local = process.env.RUNNER_TOOL_CACHE
    ? tc.find(tool, toolVersion(release.version), arch)
    : '';
  if (local) {
    for (const filename of release.filenames) {
      try {
        const sha256 = await verifyArchive(
          path.join(local, filename),
          path.join(local, `${filename}.minisig`),
          filename,
          release.sha256,
          release.size,
        );
        await cp(path.join(local, filename), path.join(directory, filename));
        await cp(
          path.join(local, `${filename}.minisig`),
          path.join(directory, `${filename}.minisig`),
        );
        found = { filename, sha256 };
        source = 'tool-cache';
        break;
      } catch (error) {
        core.debug(`Local archive cache miss: ${message(error)}`);
      }
    }
    if (!found)
      core.warning(
        'The runner tool cache contains an invalid Zig archive; downloading a verified copy.',
      );
  }
  if (!found) {
    for (const filename of release.filenames) {
      const paths = [path.join(directory, filename), path.join(directory, `${filename}.minisig`)];
      const key = archiveKey(filename);
      const hit = await options.cache.restore(paths, key);
      if (!hit) continue;
      try {
        if (hit !== key) throw new Error('Unexpected archive cache key.');
        const sha256 = await verifyArchive(
          paths[0] ?? '',
          paths[1] ?? '',
          filename,
          release.sha256,
          release.size,
        );
        found = { filename, sha256 };
        source = 'actions-cache';
        break;
      } catch (error) {
        core.warning(`Ignoring invalid Zig archive cache: ${message(error)}`);
        await rm(directory, { recursive: true, force: true });
        await mkdir(directory, { recursive: true });
      }
    }
  }
  if (!found) {
    found = await downloadArchive(directory, release, await options.mirrors());
    const archive = path.join(directory, found.filename);
    // Save the signed archive before project code can run or modify the installation.
    await options.cache.save([archive, `${archive}.minisig`], archiveKey(found.filename));
  }
  if (source !== 'tool-cache' && process.env.RUNNER_TOOL_CACHE) {
    try {
      await tc.cacheDir(directory, tool, toolVersion(release.version), arch);
    } catch (error) {
      core.warning(`Could not populate the runner tool cache: ${message(error)}`);
    }
  }
  const stagingRoot = path.join(root, 'installations');
  await mkdir(stagingRoot, { recursive: true });
  const staging = await mkdtemp(path.join(stagingRoot, 'zig-'));
  const archive = path.join(directory, found.filename);
  try {
    if (target.os === 'windows') await tc.extractZip(archive, staging);
    else await tc.extractTar(archive, staging, ['xJ', '--no-same-owner']);
    const extracted = path.join(staging, found.filename.replace(/\.(tar\.xz|zip)$/, ''));
    const executable = path.join(extracted, target.os === 'windows' ? 'zig.exe' : 'zig');
    if (!(await lstat(executable)).isFile() || !inside(staging, await realpath(executable)))
      throw new Error('The Zig archive has an unexpected layout.');
    const result = await exec.getExecOutput(executable, ['version'], { silent: true });
    if (result.stdout.trim() !== release.version)
      throw new Error(`Expected Zig ${release.version}, received ${result.stdout.trim()}.`);
    return { directory: extracted, source, sha256: found.sha256 };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
