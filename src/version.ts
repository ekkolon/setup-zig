import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { inside, record } from './util.ts';

export type Platform = { os: 'linux' | 'macos' | 'windows'; arch: 'x86_64' | 'aarch64' | 'x86' };
export type Release = { version: string; filenames: string[]; sha256?: string; size?: number };
export type VersionRequest = { kind: 'exact' | 'range' | 'master'; value: string };

// Keep the build hash: semver.valid() deliberately discards build metadata.
const exactVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.(0|[1-9]\d*)\+[a-f0-9]{7,40})?$/;

export function parseRequest(value: string): VersionRequest {
  const input = value.trim().replace(/^v(?=\d)/, '');
  if (input.length > 200 || /[\r\n\0]/.test(input)) throw new Error('Invalid Zig version.');
  if (input === 'master') return { kind: 'master', value: input };
  if (exactVersion.test(input)) {
    if (semver.lt(input, '0.7.0')) throw new Error('Zig 0.7.0 or newer is required.');
    return { kind: 'exact', value: input };
  }
  if (input === 'latest') return { kind: 'range', value: '*' };
  if (/^\d+\.\d+\.\d+-/.test(input))
    throw new Error('A Zig development version must include its complete commit hash.');
  if (input && semver.validRange(input)) return { kind: 'range', value: input };
  throw new Error(`Invalid Zig version "${value}". Use a release, range, or master.`);
}

export function platform(os: string, arch: string): Platform {
  const operatingSystem = { linux: 'linux', darwin: 'macos', win32: 'windows' }[os];
  const architecture = {
    x64: 'x86_64',
    x86_64: 'x86_64',
    arm64: 'aarch64',
    aarch64: 'aarch64',
    x86: 'x86',
    ia32: 'x86',
  }[arch];
  if (
    !operatingSystem ||
    !architecture ||
    (operatingSystem === 'macos' && architecture === 'x86')
  ) {
    throw new Error(
      `Unsupported Zig platform: ${os}/${arch}. Use Linux, macOS, or Windows with x64 or arm64 (x86 on Linux/Windows).`,
    );
  }
  return { os: operatingSystem, arch: architecture } as Platform;
}

export function filenames(version: string, target: Platform): string[] {
  if (parseRequest(version).kind !== 'exact') throw new Error('Expected an exact Zig version.');
  const extension = target.os === 'windows' ? 'zip' : 'tar.xz';
  const current = `zig-${target.arch}-${target.os}-${version}.${extension}`;
  const legacy = `zig-${target.os}-${target.arch}-${version}.${extension}`;
  // Development snapshots around the 0.14/0.15 transition used both naming schemes.
  if (version.startsWith('0.15.0-dev.')) return [current, legacy];
  return [semver.lt(version, '0.14.1') ? legacy : current];
}

export function resolveIndex(index: unknown, request: VersionRequest, target: Platform): Release {
  if (!record(index)) throw new Error('Zig download index is not an object.');
  const version =
    request.kind === 'master'
      ? record(index.master) && typeof index.master.version === 'string'
        ? index.master.version
        : ''
      : semver.maxSatisfying(
          Object.keys(index).filter((v) => exactVersion.test(v) && !v.includes('-')),
          request.value,
        );
  if (!version) throw new Error(`No published Zig release matches "${request.value}".`);
  if (parseRequest(version).kind !== 'exact')
    throw new Error('Zig index contains an invalid version.');
  const entry = index[request.kind === 'master' ? 'master' : version];
  const artifact = record(entry) ? entry[`${target.arch}-${target.os}`] : undefined;
  if (
    !record(artifact) ||
    typeof artifact.tarball !== 'string' ||
    typeof artifact.shasum !== 'string' ||
    !/^[a-f0-9]{64}$/.test(artifact.shasum)
  ) {
    throw new Error(`Zig ${version} has no valid archive for ${target.os}/${target.arch}.`);
  }
  const url = new URL(artifact.tarball);
  const filename = path.posix.basename(url.pathname);
  if (url.origin !== 'https://ziglang.org' || !filenames(version, target).includes(filename)) {
    throw new Error('Zig index contains an unexpected archive URL.');
  }
  const size = Number(artifact.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > 512 * 1024 * 1024)
    throw new Error('Zig index contains an invalid archive size.');
  return { version, filenames: [filename], sha256: artifact.shasum, size };
}

export function toolVersion(version: string): string {
  return version.replace('+', '.build.');
}

export function versionFromText(text: string, filename: string): string {
  const name = path.basename(filename);
  if (name === '.tool-versions') {
    const matches = text
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*/, '').trim())
      .filter((line) => /^zig\s/.test(line));
    if (matches.length !== 1) throw new Error('.tool-versions must contain exactly one Zig entry.');
    const parts = matches[0]?.split(/\s+/) ?? [];
    if (parts.length !== 2 || !parts[1])
      throw new Error('Specify one Zig version in .tool-versions.');
    return parts[1];
  }
  if (name === 'build.zig.zon') return minimumZigVersion(text);
  const lines = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/);
  if (lines.length !== 1 || !lines[0])
    throw new Error('A version file must contain one version or range.');
  return lines[0];
}

// Tokenize only the field we need, ignoring comments, strings, and nested objects.
// Never execute project code to determine which compiler to install.
export function minimumZigVersion(text: string): string {
  const tokens = (
    text.match(/\/\/[^\r\n]*|\\\\[^\r\n]*|"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g) ?? []
  ).filter((token) => !token.startsWith('//'));
  let depth = 0;
  const versions: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '{') depth++;
    if (token === '}') depth--;
    if (
      depth === 1 &&
      token === '.' &&
      tokens[i + 1] === 'minimum_zig_version' &&
      tokens[i + 2] === '='
    ) {
      const value = tokens[i + 3];
      if (!value || !/^"[0-9A-Za-z.+-]+"$/.test(value))
        throw new Error('minimum_zig_version must be a literal version string.');
      versions.push(value.slice(1, -1));
    }
  }
  if (versions.length !== 1 || !versions[0])
    throw new Error('build.zig.zon must contain one top-level minimum_zig_version.');
  if (parseRequest(versions[0]).kind !== 'exact')
    throw new Error('minimum_zig_version must be an exact version.');
  return versions[0];
}

export async function readVersionFile(workspace: string, filename: string): Promise<string> {
  const root = await realpath(workspace);
  const resolved = await realpath(path.resolve(root, filename));
  if (!inside(root, resolved)) throw new Error('version-file must be inside the workspace.');
  if ((await stat(resolved)).size > 1024 * 1024) throw new Error('version-file exceeds 1 MiB.');
  return versionFromText(await readFile(resolved, 'utf8'), filename);
}
