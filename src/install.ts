import {randomInt} from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as toolCache from '@actions/tool-cache';
import type {CacheStore} from './cache.ts';
import {download, getText} from './http.ts';
import {
  verifyArchive,
  verifySignatureMetadata,
  ZIG_PUBLIC_KEY,
} from './signature.ts';
import {getErrorMessage, hashString, isPathInside} from './util.ts';
import {type Platform, type Release, toToolCacheVersion} from './version.ts';

interface Installation {
  directory: string;
  source: 'download' | 'actions-cache' | 'tool-cache';
  sha256: string;
}

interface VerifiedArchive {
  filename: string;
  sha256: string;
}

interface InstallOptions {
  root: string;
  release: Release;
  target: Platform;
  cache: CacheStore;
  onWarning?: (message: string) => void;
  /** Called only after both archive caches miss. */
  getMirrors: () => Promise<string[]>;
}

export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const replacementIndex = randomInt(index + 1);
    const current = result[index];
    const replacement = result[replacementIndex];
    if (current !== undefined && replacement !== undefined) {
      result[index] = replacement;
      result[replacementIndex] = current;
    }
  }
  return result;
}

export function getArchiveCacheKey(filename: string): string {
  return `setup-zig-archive-v1-${hashString(`${ZIG_PUBLIC_KEY}\n${filename}`)}-end`;
}

export function getArtifactUrl(mirror: string, filename: string): string {
  const url = new URL(`${mirror}/${filename}`);
  url.searchParams.set('source', 'github-ekkolon-setup-zig');
  return url.href;
}

async function resetDirectory(directory: string): Promise<void> {
  await rm(directory, {recursive: true, force: true});
  await mkdir(directory, {recursive: true});
}

async function downloadArchive(
  directory: string,
  release: Release,
  mirrors: string[],
): Promise<VerifiedArchive> {
  const failures: string[] = [];
  for (const mirror of shuffle(mirrors).slice(0, 5)) {
    for (const filename of release.filenames) {
      const archive = path.join(directory, filename);
      const signature = `${archive}.minisig`;
      try {
        core.info(`Downloading ${filename} from ${new URL(mirror).host}`);
        // Reject the wrong signed filename before downloading a large archive.
        const response = await getText(
          getArtifactUrl(mirror, `${filename}.minisig`),
        );
        verifySignatureMetadata(response.body, filename);
        await writeFile(signature, response.body, {mode: 0o600});
        await download(getArtifactUrl(mirror, filename), archive);
        const sha256 = await verifyArchive(
          archive,
          signature,
          filename,
          release,
        );
        return {filename, sha256};
      } catch (error) {
        const failure = `${new URL(mirror).host}: ${getErrorMessage(error)}`;
        failures.push(failure);
        core.warning(`Mirror failed: ${failure}`);
        await rm(archive, {force: true});
        await rm(signature, {force: true});
      }
    }
  }
  throw new Error(
    `Could not download verified Zig ${release.version}. ` +
      'Older development builds may no longer be available. ' +
      'Try again or set mirror to an available HTTPS mirror.\n' +
      failures.join('\n'),
  );
}

async function restoreToolArchive(
  cachedDirectory: string,
  directory: string,
  release: Release,
): Promise<VerifiedArchive | undefined> {
  for (const filename of release.filenames) {
    const archive = path.join(cachedDirectory, filename);
    const signature = `${archive}.minisig`;
    try {
      const sha256 = await verifyArchive(archive, signature, filename, release);
      await cp(archive, path.join(directory, filename));
      await cp(signature, path.join(directory, `${filename}.minisig`));
      return {filename, sha256};
    } catch (error) {
      core.debug(`Local archive cache miss: ${getErrorMessage(error)}`);
    }
  }
  core.warning(
    'The runner tool cache contains an invalid Zig archive; downloading a verified copy.',
  );
  return undefined;
}

async function restoreActionsArchive(
  directory: string,
  release: Release,
  cache: CacheStore,
  warn: (message: string) => void,
): Promise<VerifiedArchive | undefined> {
  for (const filename of release.filenames) {
    const archive = path.join(directory, filename);
    const signature = `${archive}.minisig`;
    const key = getArchiveCacheKey(filename);
    const hit = await cache.restore([archive, signature], key);
    if (!hit) {
      continue;
    }
    try {
      if (hit !== key) {
        throw new Error('Unexpected archive cache key.');
      }
      const sha256 = await verifyArchive(archive, signature, filename, release);
      return {filename, sha256};
    } catch (error) {
      warn(`Ignoring invalid Zig archive cache: ${getErrorMessage(error)}`);
      await resetDirectory(directory);
    }
  }
  return undefined;
}

async function extractArchive(
  archive: string,
  root: string,
  release: Release,
  target: Platform,
): Promise<string> {
  const stagingRoot = path.join(root, 'installations');
  await mkdir(stagingRoot, {recursive: true});
  const staging = await mkdtemp(path.join(stagingRoot, 'zig-'));
  try {
    if (target.os === 'windows') {
      await toolCache.extractZip(archive, staging);
    } else {
      await toolCache.extractTar(archive, staging, ['xJ', '--no-same-owner']);
    }
    const directory = path.join(
      staging,
      path.basename(archive).replace(/\.(tar\.xz|zip)$/, ''),
    );
    const executable = path.join(
      directory,
      target.os === 'windows' ? 'zig.exe' : 'zig',
    );
    if (
      !(await lstat(executable)).isFile() ||
      !isPathInside(staging, await realpath(executable))
    ) {
      throw new Error('The Zig archive has an unexpected layout.');
    }
    const result = await exec.getExecOutput(executable, ['version'], {
      silent: true,
    });
    const version = result.stdout.trim();
    if (version !== release.version) {
      throw new Error(`Expected Zig ${release.version}, received ${version}.`);
    }
    return directory;
  } catch (error) {
    await rm(staging, {recursive: true, force: true});
    throw error;
  }
}

/** Re-verifies archives and extracts a fresh installation for each use. */
export async function installZig(
  options: InstallOptions,
): Promise<Installation> {
  const {root, release, target} = options;
  const archiveId = hashString(
    `${target.os}/${target.arch}/${release.version}`,
  );
  const directory = path.join(root, 'archives', archiveId);
  await resetDirectory(directory);
  try {
    const toolName = `zig-archive-v1-${hashString(ZIG_PUBLIC_KEY).slice(0, 16)}`;
    const cacheVersion = toToolCacheVersion(release.version);
    const cachePlatform = `${target.os}-${target.arch}`;
    const cachedDirectory = process.env.RUNNER_TOOL_CACHE
      ? toolCache.find(toolName, cacheVersion, cachePlatform)
      : '';
    let source: Installation['source'] = 'download';
    let verified: VerifiedArchive | undefined;
    if (cachedDirectory) {
      verified = await restoreToolArchive(cachedDirectory, directory, release);
      if (verified) {
        source = 'tool-cache';
      }
    }
    if (!verified) {
      verified = await restoreActionsArchive(
        directory,
        release,
        options.cache,
        options.onWarning ?? core.warning,
      );
      if (verified) {
        source = 'actions-cache';
      }
    }
    if (!verified) {
      // A failed cache extraction can leave incomplete files behind.
      await resetDirectory(directory);
      verified = await downloadArchive(
        directory,
        release,
        await options.getMirrors(),
      );
      const archive = path.join(directory, verified.filename);
      // Save before project code can run or modify the installation.
      await options.cache.save(
        [archive, `${archive}.minisig`],
        getArchiveCacheKey(verified.filename),
      );
    }
    if (source !== 'tool-cache' && process.env.RUNNER_TOOL_CACHE) {
      try {
        await toolCache.cacheDir(
          directory,
          toolName,
          cacheVersion,
          cachePlatform,
        );
      } catch (error) {
        core.warning(
          `Could not populate the runner tool cache: ${getErrorMessage(error)}`,
        );
      }
    }

    const archive = path.join(directory, verified.filename);
    const installedDirectory = await extractArchive(
      archive,
      root,
      release,
      target,
    );
    return {directory: installedDirectory, source, sha256: verified.sha256};
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}
