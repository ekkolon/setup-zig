import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);
import {
  HttpClient,
  __toESM,
  addPath,
  cp,
  createCacheStore,
  debug,
  exec,
  getBooleanInput,
  getErrorMessage,
  getExecOutput,
  getInput,
  hashString,
  info,
  isDebug,
  isPathInside,
  isRecord,
  mkdirP,
  readJson,
  require_semver,
  restoreBuildCache,
  rmRF,
  setFailed,
  setOutput,
  warning,
  which,
  writeJson
} from "./chunk-72S36MPG.js";

// src/main.ts
import path5 from "node:path";

// src/install.ts
import { randomInt } from "node:crypto";
import {
  cp as cp2,
  lstat,
  mkdir,
  mkdtemp,
  realpath as realpath2,
  rm as rm2,
  writeFile
} from "node:fs/promises";
import path3 from "node:path";

// node_modules/.pnpm/@actions+tool-cache@4.0.0/node_modules/@actions/tool-cache/lib/tool-cache.js
import * as crypto from "crypto";
import * as fs from "fs";

// node_modules/.pnpm/@actions+tool-cache@4.0.0/node_modules/@actions/tool-cache/lib/manifest.js
var semver = __toESM(require_semver(), 1);

// node_modules/.pnpm/@actions+tool-cache@4.0.0/node_modules/@actions/tool-cache/lib/tool-cache.js
import * as os from "os";
import * as path from "path";
var semver2 = __toESM(require_semver(), 1);
import { ok } from "assert";
var __awaiter = function(thisArg, _arguments, P, generator) {
  function adopt(value) {
    return value instanceof P ? value : new P(function(resolve) {
      resolve(value);
    });
  }
  return new (P || (P = Promise))(function(resolve, reject) {
    function fulfilled(value) {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    }
    function rejected(value) {
      try {
        step(generator["throw"](value));
      } catch (e) {
        reject(e);
      }
    }
    function step(result) {
      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
    }
    step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
};
var IS_WINDOWS = process.platform === "win32";
var IS_MAC = process.platform === "darwin";
function extractTar(file_1, dest_1) {
  return __awaiter(this, arguments, void 0, function* (file, dest, flags = "xz") {
    if (!file) {
      throw new Error("parameter 'file' is required");
    }
    dest = yield _createExtractFolder(dest);
    debug("Checking tar --version");
    let versionOutput = "";
    yield exec("tar --version", [], {
      ignoreReturnCode: true,
      silent: true,
      listeners: {
        stdout: (data) => versionOutput += data.toString(),
        stderr: (data) => versionOutput += data.toString()
      }
    });
    debug(versionOutput.trim());
    const isGnuTar = versionOutput.toUpperCase().includes("GNU TAR");
    let args;
    if (flags instanceof Array) {
      args = flags;
    } else {
      args = [flags];
    }
    if (isDebug() && !flags.includes("v")) {
      args.push("-v");
    }
    let destArg = dest;
    let fileArg = file;
    if (IS_WINDOWS && isGnuTar) {
      args.push("--force-local");
      destArg = dest.replace(/\\/g, "/");
      fileArg = file.replace(/\\/g, "/");
    }
    if (isGnuTar) {
      args.push("--warning=no-unknown-keyword");
      args.push("--overwrite");
    }
    args.push("-C", destArg, "-f", fileArg);
    yield exec(`tar`, args);
    return dest;
  });
}
function extractZip(file, dest) {
  return __awaiter(this, void 0, void 0, function* () {
    if (!file) {
      throw new Error("parameter 'file' is required");
    }
    dest = yield _createExtractFolder(dest);
    if (IS_WINDOWS) {
      yield extractZipWin(file, dest);
    } else {
      yield extractZipNix(file, dest);
    }
    return dest;
  });
}
function extractZipWin(file, dest) {
  return __awaiter(this, void 0, void 0, function* () {
    const escapedFile = file.replace(/'/g, "''").replace(/"|\n|\r/g, "");
    const escapedDest = dest.replace(/'/g, "''").replace(/"|\n|\r/g, "");
    const pwshPath = yield which("pwsh", false);
    if (pwshPath) {
      const pwshCommand = [
        `$ErrorActionPreference = 'Stop' ;`,
        `try { Add-Type -AssemblyName System.IO.Compression.ZipFile } catch { } ;`,
        `try { [System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedFile}', '${escapedDest}', $true) }`,
        `catch { if (($_.Exception.GetType().FullName -eq 'System.Management.Automation.MethodException') -or ($_.Exception.GetType().FullName -eq 'System.Management.Automation.RuntimeException') ){ Expand-Archive -LiteralPath '${escapedFile}' -DestinationPath '${escapedDest}' -Force } else { throw $_ } } ;`
      ].join(" ");
      const args = [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Unrestricted",
        "-Command",
        pwshCommand
      ];
      debug(`Using pwsh at path: ${pwshPath}`);
      yield exec(`"${pwshPath}"`, args);
    } else {
      const powershellCommand = [
        `$ErrorActionPreference = 'Stop' ;`,
        `try { Add-Type -AssemblyName System.IO.Compression.FileSystem } catch { } ;`,
        `if ((Get-Command -Name Expand-Archive -Module Microsoft.PowerShell.Archive -ErrorAction Ignore)) { Expand-Archive -LiteralPath '${escapedFile}' -DestinationPath '${escapedDest}' -Force }`,
        `else {[System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedFile}', '${escapedDest}', $true) }`
      ].join(" ");
      const args = [
        "-NoLogo",
        "-Sta",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Unrestricted",
        "-Command",
        powershellCommand
      ];
      const powershellPath = yield which("powershell", true);
      debug(`Using powershell at path: ${powershellPath}`);
      yield exec(`"${powershellPath}"`, args);
    }
  });
}
function extractZipNix(file, dest) {
  return __awaiter(this, void 0, void 0, function* () {
    const unzipPath = yield which("unzip", true);
    const args = [file];
    if (!isDebug()) {
      args.unshift("-q");
    }
    args.unshift("-o");
    yield exec(`"${unzipPath}"`, args, { cwd: dest });
  });
}
function cacheDir(sourceDir, tool, version, arch2) {
  return __awaiter(this, void 0, void 0, function* () {
    version = semver2.clean(version) || version;
    arch2 = arch2 || os.arch();
    debug(`Caching tool ${tool} ${version} ${arch2}`);
    debug(`source dir: ${sourceDir}`);
    if (!fs.statSync(sourceDir).isDirectory()) {
      throw new Error("sourceDir is not a directory");
    }
    const destPath = yield _createToolPath(tool, version, arch2);
    for (const itemName of fs.readdirSync(sourceDir)) {
      const s = path.join(sourceDir, itemName);
      yield cp(s, destPath, { recursive: true });
    }
    _completeToolPath(tool, version, arch2);
    return destPath;
  });
}
function find(toolName, versionSpec, arch2) {
  if (!toolName) {
    throw new Error("toolName parameter is required");
  }
  if (!versionSpec) {
    throw new Error("versionSpec parameter is required");
  }
  arch2 = arch2 || os.arch();
  if (!isExplicitVersion(versionSpec)) {
    const localVersions = findAllVersions(toolName, arch2);
    const match = evaluateVersions(localVersions, versionSpec);
    versionSpec = match;
  }
  let toolPath = "";
  if (versionSpec) {
    versionSpec = semver2.clean(versionSpec) || "";
    const cachePath = path.join(_getCacheDirectory(), toolName, versionSpec, arch2);
    debug(`checking cache: ${cachePath}`);
    if (fs.existsSync(cachePath) && fs.existsSync(`${cachePath}.complete`)) {
      debug(`Found tool in cache ${toolName} ${versionSpec} ${arch2}`);
      toolPath = cachePath;
    } else {
      debug("not found");
    }
  }
  return toolPath;
}
function findAllVersions(toolName, arch2) {
  const versions = [];
  arch2 = arch2 || os.arch();
  const toolPath = path.join(_getCacheDirectory(), toolName);
  if (fs.existsSync(toolPath)) {
    const children = fs.readdirSync(toolPath);
    for (const child of children) {
      if (isExplicitVersion(child)) {
        const fullPath = path.join(toolPath, child, arch2 || "");
        if (fs.existsSync(fullPath) && fs.existsSync(`${fullPath}.complete`)) {
          versions.push(child);
        }
      }
    }
  }
  return versions;
}
function _createExtractFolder(dest) {
  return __awaiter(this, void 0, void 0, function* () {
    if (!dest) {
      dest = path.join(_getTempDirectory(), crypto.randomUUID());
    }
    yield mkdirP(dest);
    return dest;
  });
}
function _createToolPath(tool, version, arch2) {
  return __awaiter(this, void 0, void 0, function* () {
    const folderPath = path.join(_getCacheDirectory(), tool, semver2.clean(version) || version, arch2 || "");
    debug(`destination ${folderPath}`);
    const markerPath = `${folderPath}.complete`;
    yield rmRF(folderPath);
    yield rmRF(markerPath);
    yield mkdirP(folderPath);
    return folderPath;
  });
}
function _completeToolPath(tool, version, arch2) {
  const folderPath = path.join(_getCacheDirectory(), tool, semver2.clean(version) || version, arch2 || "");
  const markerPath = `${folderPath}.complete`;
  fs.writeFileSync(markerPath, "");
  debug("finished caching tool");
}
function isExplicitVersion(versionSpec) {
  const c = semver2.clean(versionSpec) || "";
  debug(`isExplicit: ${c}`);
  const valid2 = semver2.valid(c) != null;
  debug(`explicit? ${valid2}`);
  return valid2;
}
function evaluateVersions(versions, versionSpec) {
  let version = "";
  debug(`evaluating ${versions.length} versions`);
  versions = versions.sort((a, b) => {
    if (semver2.gt(a, b)) {
      return 1;
    }
    return -1;
  });
  for (let i = versions.length - 1; i >= 0; i--) {
    const potential = versions[i];
    const satisfied = semver2.satisfies(potential, versionSpec);
    if (satisfied) {
      version = potential;
      break;
    }
  }
  if (version) {
    debug(`matched: ${version}`);
  } else {
    debug("match not found");
  }
  return version;
}
function _getCacheDirectory() {
  const cacheDirectory = process.env["RUNNER_TOOL_CACHE"] || "";
  ok(cacheDirectory, "Expected RUNNER_TOOL_CACHE to be defined");
  return cacheDirectory;
}
function _getTempDirectory() {
  const tempDirectory = process.env["RUNNER_TEMP"] || "";
  ok(tempDirectory, "Expected RUNNER_TEMP to be defined");
  return tempDirectory;
}

// src/http.ts
import { createWriteStream as createWriteStream2 } from "node:fs";
import { rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
function parseHttpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(
      "Download URLs must use HTTPS without credentials or fragments."
    );
  }
  return url;
}
function createHttpClient(signal) {
  return new HttpClient(
    "ekkolon/setup-zig",
    [
      {
        prepareRequest(options) {
          options.signal = signal;
        },
        canHandleAuthentication() {
          return false;
        },
        async handleAuthentication() {
          throw new Error("Download authentication is not supported.");
        }
      }
    ],
    {
      allowRetries: false,
      allowRedirectDowngrade: false,
      maxRedirects: 5,
      socketTimeout: 3e4
    }
  );
}
async function getText(url, headers = {}) {
  parseHttpsUrl(url);
  const http = createHttpClient(AbortSignal.timeout(45e3));
  try {
    const response = await http.get(url, headers);
    const status = response.message.statusCode ?? 0;
    if (status !== 200 && status !== 304) {
      response.message.destroy();
      throw new Error(`HTTP ${status} from ${new URL(url).host}.`);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.message) {
      size += chunk.length;
      if (size > 1024 * 1024) {
        response.message.destroy();
        throw new Error("Download metadata exceeds 1 MiB.");
      }
      chunks.push(Buffer.from(chunk));
    }
    const result = {
      status,
      body: Buffer.concat(chunks).toString("utf8")
    };
    if (response.message.headers.etag) {
      result.etag = response.message.headers.etag;
    }
    if (response.message.headers["last-modified"]) {
      result.modified = response.message.headers["last-modified"];
    }
    return result;
  } finally {
    http.dispose();
  }
}
async function* limitArchiveSize(source) {
  let size = 0;
  for await (const chunk of source) {
    size += chunk.length;
    if (size > 512 * 1024 * 1024) {
      throw new Error("Zig archive exceeds 512 MiB.");
    }
    yield chunk;
  }
}
async function download(url, destination) {
  parseHttpsUrl(url);
  const signal = AbortSignal.timeout(18e4);
  const http = createHttpClient(signal);
  try {
    const response = await http.get(url);
    if (response.message.statusCode !== 200) {
      response.message.destroy();
      throw new Error(
        `HTTP ${response.message.statusCode} from ${new URL(url).host}.`
      );
    }
    await pipeline(
      response.message,
      limitArchiveSize,
      createWriteStream2(destination, { flags: "wx", mode: 384 }),
      { signal }
    );
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  } finally {
    http.dispose();
  }
}

// src/signature.ts
import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
var ZIG_PUBLIC_KEY = "RWSGOq2NVecA2UPNdBUZykf1CCb147pkmdtYxgb3Ti+JO/wCYvhbAb/U";
var ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");
function decodeBase64(text, size) {
  const buffer = Buffer.from(text, "base64");
  if (buffer.length !== size || buffer.toString("base64") !== text) {
    throw new Error("Malformed minisign data.");
  }
  return buffer;
}
function verifySignatureMetadata(text, filename, publicKey = ZIG_PUBLIC_KEY) {
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.length !== 4 || !lines[0]?.startsWith("untrusted comment: ") || !lines[2]?.startsWith("trusted comment: ")) {
    throw new Error("Malformed minisign signature.");
  }
  const key = decodeBase64(publicKey, 42);
  const packet = decodeBase64(lines[1] ?? "", 74);
  if (key.subarray(0, 2).toString() !== "Ed" || packet.subarray(0, 2).toString() !== "ED") {
    throw new Error("Expected a prehashed Ed25519 minisign signature.");
  }
  if (!key.subarray(2, 10).equals(packet.subarray(2, 10))) {
    throw new Error("The archive was not signed with the Zig release key.");
  }
  const publicKeyObject = createPublicKey({
    key: Buffer.concat([ED25519_SPKI, key.subarray(10)]),
    format: "der",
    type: "spki"
  });
  const signature = packet.subarray(10);
  const comment = lines[2].slice("trusted comment: ".length);
  if (!verify(
    null,
    Buffer.concat([signature, Buffer.from(comment)]),
    publicKeyObject,
    decodeBase64(lines[3] ?? "", 64)
  )) {
    throw new Error("Invalid minisign trusted-comment signature.");
  }
  const names = [...comment.matchAll(/(?:^|\s)file:([^\s]+)/g)].map(
    (match) => match[1]
  );
  if (names.length !== 1 || names[0] !== filename) {
    throw new Error(
      "Signed archive filename does not match the requested Zig version and platform."
    );
  }
  return { signature, key: publicKeyObject };
}
async function verifyArchive(archive, signatureFile, filename, checks = {}) {
  const { signature, key } = verifySignatureMetadata(
    await readFile(signatureFile, "utf8"),
    filename,
    checks.publicKey
  );
  const prehash = createHash("blake2b512");
  const sha256 = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(archive)) {
    size += chunk.length;
    if (size > 512 * 1024 * 1024) {
      throw new Error("Zig archive exceeds 512 MiB.");
    }
    prehash.update(chunk);
    sha256.update(chunk);
  }
  if (checks.size !== void 0 && size !== checks.size) {
    throw new Error("Zig archive size does not match the download index.");
  }
  const checksum = sha256.digest("hex");
  if (checks.sha256 && checksum !== checks.sha256) {
    throw new Error("Zig archive SHA-256 mismatch.");
  }
  if (!verify(null, prehash.digest(), key, signature)) {
    throw new Error("Zig archive minisign verification failed.");
  }
  return checksum;
}

// src/version.ts
var import_semver = __toESM(require_semver(), 1);
import { readFile as readFile2, realpath, stat } from "node:fs/promises";
import path2 from "node:path";
var EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.(0|[1-9]\d*)\+[a-f0-9]{7,40})?$/;
var OPERATING_SYSTEMS = /* @__PURE__ */ new Map([
  ["linux", "linux"],
  ["darwin", "macos"],
  ["win32", "windows"]
]);
var ARCHITECTURES = /* @__PURE__ */ new Map([
  ["x64", "x86_64"],
  ["x86_64", "x86_64"],
  ["arm64", "aarch64"],
  ["aarch64", "aarch64"],
  ["x86", "x86"],
  ["ia32", "x86"]
]);
function parseVersionRequest(value) {
  const input = value.trim().replace(/^v(?=\d)/, "");
  if (input.length > 200 || /[\r\n\0]/.test(input)) {
    throw new Error("Invalid Zig version.");
  }
  if (input === "master") {
    return { kind: "master", value: input };
  }
  if (EXACT_VERSION.test(input)) {
    if (import_semver.default.lt(input, "0.7.0")) {
      throw new Error("Zig 0.7.0 or newer is required.");
    }
    return { kind: "exact", value: input };
  }
  if (input === "latest") {
    return { kind: "range", value: "*" };
  }
  if (/^\d+\.\d+\.\d+-/.test(input)) {
    throw new Error(
      "A Zig development version must include its complete commit hash."
    );
  }
  if (input && import_semver.default.validRange(input)) {
    return { kind: "range", value: input };
  }
  throw new Error(
    `Invalid Zig version "${value}". Use a release, range, or master.`
  );
}
function resolvePlatform(os2, arch2) {
  const operatingSystem = OPERATING_SYSTEMS.get(os2);
  const architecture = ARCHITECTURES.get(arch2);
  if (!operatingSystem || !architecture || operatingSystem === "macos" && architecture === "x86") {
    throw new Error(
      `Unsupported Zig platform: ${os2}/${arch2}. Use Linux, macOS, or Windows with x64 or arm64 (x86 on Linux/Windows).`
    );
  }
  return { os: operatingSystem, arch: architecture };
}
function getArchiveFilenames(version, target) {
  if (parseVersionRequest(version).kind !== "exact") {
    throw new Error("Expected an exact Zig version.");
  }
  const extension = target.os === "windows" ? "zip" : "tar.xz";
  const current = `zig-${target.arch}-${target.os}-${version}.${extension}`;
  const legacy = `zig-${target.os}-${target.arch}-${version}.${extension}`;
  if (version.startsWith("0.15.0-dev.")) {
    return [current, legacy];
  }
  return [import_semver.default.lt(version, "0.14.1") ? legacy : current];
}
function resolveReleaseFromIndex(index, request, target) {
  if (!isRecord(index)) {
    throw new Error("Zig download index is not an object.");
  }
  let version = null;
  if (request.kind === "master") {
    if (isRecord(index.master) && typeof index.master.version === "string") {
      version = index.master.version;
    }
  } else {
    const releases = Object.keys(index).filter(
      (candidate) => EXACT_VERSION.test(candidate) && !candidate.includes("-")
    );
    version = import_semver.default.maxSatisfying(releases, request.value);
  }
  if (!version) {
    throw new Error(`No published Zig release matches "${request.value}".`);
  }
  if (parseVersionRequest(version).kind !== "exact") {
    throw new Error("Zig index contains an invalid version.");
  }
  const entry = index[request.kind === "master" ? "master" : version];
  const artifact = isRecord(entry) ? entry[`${target.arch}-${target.os}`] : void 0;
  if (!isRecord(artifact) || typeof artifact.tarball !== "string" || typeof artifact.shasum !== "string" || !/^[a-f0-9]{64}$/.test(artifact.shasum)) {
    throw new Error(
      `Zig ${version} has no valid archive for ${target.os}/${target.arch}.`
    );
  }
  const url = new URL(artifact.tarball);
  const filename = path2.posix.basename(url.pathname);
  if (url.origin !== "https://ziglang.org" || !getArchiveFilenames(version, target).includes(filename)) {
    throw new Error("Zig index contains an unexpected archive URL.");
  }
  const size = Number(artifact.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > 512 * 1024 * 1024) {
    throw new Error("Zig index contains an invalid archive size.");
  }
  return { version, filenames: [filename], sha256: artifact.shasum, size };
}
function toToolCacheVersion(version) {
  return version.replace("+", ".build.");
}
function parseVersionFile(text, filename) {
  const name = path2.basename(filename);
  if (name === ".tool-versions") {
    const matches = text.split(/\r?\n/).map((line) => line.replace(/#.*/, "").trim()).filter((line) => /^zig\s/.test(line));
    if (matches.length !== 1) {
      throw new Error(".tool-versions must contain exactly one Zig entry.");
    }
    const parts = matches[0]?.split(/\s+/) ?? [];
    if (parts.length !== 2 || !parts[1]) {
      throw new Error("Specify one Zig version in .tool-versions.");
    }
    return parts[1];
  }
  if (name === "build.zig.zon") {
    return parseMinimumZigVersion(text);
  }
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length !== 1 || !lines[0]) {
    throw new Error("A version file must contain one version or range.");
  }
  return lines[0];
}
function parseMinimumZigVersion(text) {
  const tokens = (text.match(
    /\/\/[^\r\n]*|\\\\[^\r\n]*|"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g
  ) ?? []).filter((token) => !token.startsWith("//"));
  let depth = 0;
  const versions = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "{") {
      depth++;
    }
    if (token === "}") {
      depth--;
    }
    if (depth === 1 && token === "." && tokens[index + 1] === "minimum_zig_version" && tokens[index + 2] === "=") {
      const value = tokens[index + 3];
      if (!value || !/^"[0-9A-Za-z.+-]+"$/.test(value)) {
        throw new Error(
          "minimum_zig_version must be a literal version string."
        );
      }
      versions.push(value.slice(1, -1));
    }
  }
  if (versions.length !== 1 || !versions[0]) {
    throw new Error(
      "build.zig.zon must contain one top-level minimum_zig_version."
    );
  }
  if (parseVersionRequest(versions[0]).kind !== "exact") {
    throw new Error("minimum_zig_version must be an exact version.");
  }
  return versions[0];
}
async function readVersionFile(workspace, filename) {
  const root = await realpath(workspace);
  const resolved = await realpath(path2.resolve(root, filename));
  if (!isPathInside(root, resolved)) {
    throw new Error("version-file must be inside the workspace.");
  }
  if ((await stat(resolved)).size > 1024 * 1024) {
    throw new Error("version-file exceeds 1 MiB.");
  }
  return parseVersionFile(await readFile2(resolved, "utf8"), filename);
}

// src/install.ts
function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const replacementIndex = randomInt(index + 1);
    const current = result[index];
    const replacement = result[replacementIndex];
    if (current !== void 0 && replacement !== void 0) {
      result[index] = replacement;
      result[replacementIndex] = current;
    }
  }
  return result;
}
function getArchiveCacheKey(filename) {
  return `setup-zig-archive-v1-${hashString(`${ZIG_PUBLIC_KEY}
${filename}`)}-end`;
}
function getArtifactUrl(mirror, filename) {
  const url = new URL(`${mirror}/${filename}`);
  url.searchParams.set("source", "github-ekkolon-setup-zig");
  return url.href;
}
async function resetDirectory(directory) {
  await rm2(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}
async function downloadArchive(directory, release, mirrors) {
  const failures = [];
  for (const mirror of shuffle(mirrors).slice(0, 5)) {
    for (const filename of release.filenames) {
      const archive = path3.join(directory, filename);
      const signature = `${archive}.minisig`;
      try {
        info(`Downloading ${filename} from ${new URL(mirror).host}`);
        const response = await getText(
          getArtifactUrl(mirror, `${filename}.minisig`)
        );
        verifySignatureMetadata(response.body, filename);
        await writeFile(signature, response.body, { mode: 384 });
        await download(getArtifactUrl(mirror, filename), archive);
        const sha256 = await verifyArchive(
          archive,
          signature,
          filename,
          release
        );
        return { filename, sha256 };
      } catch (error) {
        const failure = `${new URL(mirror).host}: ${getErrorMessage(error)}`;
        failures.push(failure);
        warning(`Mirror failed: ${failure}`);
        await rm2(archive, { force: true });
        await rm2(signature, { force: true });
      }
    }
  }
  throw new Error(
    `Could not download verified Zig ${release.version}. Older development builds may no longer be available. Try again or set mirror to an available HTTPS mirror.
` + failures.join("\n")
  );
}
async function restoreToolArchive(cachedDirectory, directory, release) {
  for (const filename of release.filenames) {
    const archive = path3.join(cachedDirectory, filename);
    const signature = `${archive}.minisig`;
    try {
      const sha256 = await verifyArchive(archive, signature, filename, release);
      await cp2(archive, path3.join(directory, filename));
      await cp2(signature, path3.join(directory, `${filename}.minisig`));
      return { filename, sha256 };
    } catch (error) {
      debug(`Local archive cache miss: ${getErrorMessage(error)}`);
    }
  }
  warning(
    "The runner tool cache contains an invalid Zig archive; downloading a verified copy."
  );
  return void 0;
}
async function restoreActionsArchive(directory, release, cache) {
  for (const filename of release.filenames) {
    const archive = path3.join(directory, filename);
    const signature = `${archive}.minisig`;
    const key = getArchiveCacheKey(filename);
    const hit = await cache.restore([archive, signature], key);
    if (!hit) {
      continue;
    }
    try {
      if (hit !== key) {
        throw new Error("Unexpected archive cache key.");
      }
      const sha256 = await verifyArchive(archive, signature, filename, release);
      return { filename, sha256 };
    } catch (error) {
      warning(
        `Ignoring invalid Zig archive cache: ${getErrorMessage(error)}`
      );
      await resetDirectory(directory);
    }
  }
  return void 0;
}
async function extractArchive(archive, root, release, target) {
  const stagingRoot = path3.join(root, "installations");
  await mkdir(stagingRoot, { recursive: true });
  const staging = await mkdtemp(path3.join(stagingRoot, "zig-"));
  try {
    if (target.os === "windows") {
      await extractZip(archive, staging);
    } else {
      await extractTar(archive, staging, ["xJ", "--no-same-owner"]);
    }
    const directory = path3.join(
      staging,
      path3.basename(archive).replace(/\.(tar\.xz|zip)$/, "")
    );
    const executable = path3.join(
      directory,
      target.os === "windows" ? "zig.exe" : "zig"
    );
    if (!(await lstat(executable)).isFile() || !isPathInside(staging, await realpath2(executable))) {
      throw new Error("The Zig archive has an unexpected layout.");
    }
    const result = await getExecOutput(executable, ["version"], {
      silent: true
    });
    const version = result.stdout.trim();
    if (version !== release.version) {
      throw new Error(`Expected Zig ${release.version}, received ${version}.`);
    }
    return directory;
  } catch (error) {
    await rm2(staging, { recursive: true, force: true });
    throw error;
  }
}
async function installZig(options) {
  const { root, release, target } = options;
  const archiveId = hashString(
    `${target.os}/${target.arch}/${release.version}`
  );
  const directory = path3.join(root, "archives", archiveId);
  await resetDirectory(directory);
  try {
    const toolName = `zig-archive-v1-${hashString(ZIG_PUBLIC_KEY).slice(0, 16)}`;
    const cacheVersion = toToolCacheVersion(release.version);
    const cachePlatform = `${target.os}-${target.arch}`;
    const cachedDirectory = process.env.RUNNER_TOOL_CACHE ? find(toolName, cacheVersion, cachePlatform) : "";
    let source = "download";
    let verified;
    if (cachedDirectory) {
      verified = await restoreToolArchive(cachedDirectory, directory, release);
      if (verified) {
        source = "tool-cache";
      }
    }
    if (!verified) {
      verified = await restoreActionsArchive(directory, release, options.cache);
      if (verified) {
        source = "actions-cache";
      }
    }
    if (!verified) {
      await resetDirectory(directory);
      verified = await downloadArchive(
        directory,
        release,
        await options.getMirrors()
      );
      const archive2 = path3.join(directory, verified.filename);
      await options.cache.save(
        [archive2, `${archive2}.minisig`],
        getArchiveCacheKey(verified.filename)
      );
    }
    if (source !== "tool-cache" && process.env.RUNNER_TOOL_CACHE) {
      try {
        await cacheDir(
          directory,
          toolName,
          cacheVersion,
          cachePlatform
        );
      } catch (error) {
        warning(
          `Could not populate the runner tool cache: ${getErrorMessage(error)}`
        );
      }
    }
    const archive = path3.join(directory, verified.filename);
    const installedDirectory = await extractArchive(
      archive,
      root,
      release,
      target
    );
    return { directory: installedDirectory, source, sha256: verified.sha256 };
  } finally {
    await rm2(directory, { recursive: true, force: true });
  }
}

// src/metadata.ts
import path4 from "node:path";
var INDEX_URL = "https://ziglang.org/download/index.json";
var MIRRORS_URL = "https://ziglang.org/download/community-mirrors.txt";
function isSnapshot(value, url, now) {
  return isRecord(value) && value.url === url && typeof value.body === "string" && value.body.length <= 1024 * 1024 && typeof value.fetchedAt === "number" && value.fetchedAt > 0 && value.fetchedAt <= now && (value.etag === void 0 || typeof value.etag === "string") && (value.modified === void 0 || typeof value.modified === "string");
}
async function readSnapshot(file, options, now) {
  try {
    const data = await readJson(file);
    if (isSnapshot(data, options.url, now)) {
      options.parse(data.body);
      return data;
    }
  } catch {
  }
  return void 0;
}
async function readCachedMetadata(options) {
  const now = options.now ?? Date.now();
  const file = path4.join(options.root, "metadata", `${options.name}.json`);
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
  const headers = {};
  if (saved?.etag) {
    headers["If-None-Match"] = saved.etag;
  }
  if (saved?.modified) {
    headers["If-Modified-Since"] = saved.modified;
  }
  try {
    const response = await (options.fetchText ?? getText)(options.url, headers);
    if (response.status !== 200 && !(response.status === 304 && saved)) {
      throw new Error("Unexpected metadata response.");
    }
    const body = response.status === 304 && saved ? saved.body : response.body;
    const result = options.parse(body);
    const next = { url: options.url, fetchedAt: now, body };
    const etag = response.etag ?? (response.status === 304 ? saved?.etag : void 0);
    const modified = response.modified ?? (response.status === 304 ? saved?.modified : void 0);
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
    if (saved && options.maxStaleAgeMs && now - saved.fetchedAt < options.maxStaleAgeMs) {
      warning(
        `Could not refresh ${options.name}; using the cached list: ${getErrorMessage(error)}`
      );
      return options.parse(saved.body);
    }
    throw new Error(
      `Could not fetch Zig ${options.name}: ${getErrorMessage(error)}`
    );
  }
}
function parseIndex(text) {
  const value = JSON.parse(text);
  if (!isRecord(value) || !isRecord(value.master)) {
    throw new Error("Invalid Zig download index.");
  }
  return value;
}
function parseMirrorUrl(value) {
  const url = parseHttpsUrl(value);
  if (url.search || /(^|\.)ziglang\.org$/i.test(url.hostname)) {
    throw new Error("Use a community mirror URL without a query string.");
  }
  return url.href.replace(/\/$/, "");
}
function parseMirrors(text) {
  const lines = text.trim().split(/\r?\n/).map((line) => parseMirrorUrl(line.trim()));
  if (lines.length < 1 || lines.length > 100) {
    throw new Error("Invalid community mirror list.");
  }
  return [...new Set(lines)];
}

// src/main.ts
async function run() {
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) {
    throw new Error(
      "RUNNER_TEMP is not set. Run setup-zig in a GitHub Actions job."
    );
  }
  const root = path5.join(runnerTemp, "setup-zig-v1");
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  let versionInput = getInput("version");
  const versionFile = getInput("version-file");
  if (versionInput && versionFile) {
    warning("version takes precedence over version-file.");
  }
  if (!versionInput) {
    versionInput = versionFile ? await readVersionFile(workspace, versionFile) : "latest";
  }
  const request = parseVersionRequest(versionInput);
  const target = resolvePlatform(
    process.platform,
    getInput("architecture") || process.arch
  );
  const checksum = getInput("checksum").toLowerCase();
  if (checksum && !/^[a-f0-9]{64}$/.test(checksum)) {
    throw new Error(
      "checksum must be a SHA-256 digest (64 hexadecimal characters)."
    );
  }
  const customMirror = getInput("mirror");
  const mirror = customMirror ? parseMirrorUrl(customMirror) : "";
  const readOnly = getBooleanInput("cache-read-only");
  const toolchainCache = createCacheStore(
    getBooleanInput("cache-toolchain"),
    readOnly
  );
  const useBuildCache = getBooleanInput("cache");
  const cacheSizeLimitMib = Number(getInput("cache-size-limit"));
  if (!Number.isSafeInteger(cacheSizeLimitMib) || cacheSizeLimitMib < 1 || cacheSizeLimitMib > 10240) {
    throw new Error("cache-size-limit must be between 1 and 10240 MiB.");
  }
  let release;
  if (request.kind === "exact") {
    release = {
      version: request.value,
      filenames: getArchiveFilenames(request.value, target)
    };
  } else {
    const index = await readCachedMetadata({
      name: "index",
      url: INDEX_URL,
      ttlMs: 60 * 60 * 1e3,
      root,
      cache: toolchainCache,
      parse: parseIndex,
      forceRefresh: getBooleanInput("check-latest")
    });
    release = resolveReleaseFromIndex(index, request, target);
  }
  if (checksum) {
    if (release.sha256 && checksum !== release.sha256) {
      throw new Error("checksum does not match the Zig download index.");
    }
    release.sha256 = checksum;
  }
  const installation = await installZig({
    root,
    release,
    target,
    cache: toolchainCache,
    getMirrors: async () => {
      if (mirror) {
        return [mirror];
      }
      return readCachedMetadata({
        name: "mirrors",
        url: MIRRORS_URL,
        ttlMs: 24 * 60 * 60 * 1e3,
        maxStaleAgeMs: 7 * 24 * 60 * 60 * 1e3,
        root,
        cache: toolchainCache,
        parse: parseMirrors
      });
    }
  });
  let cacheHit = false;
  let globalCacheDirectory = process.env.ZIG_GLOBAL_CACHE_DIR ?? "";
  if (useBuildCache) {
    const restored = await restoreBuildCache({
      root,
      version: release.version,
      target: `${target.os}-${target.arch}`,
      scope: getInput("cache-key"),
      dependencyPath: getInput("cache-dependency-path"),
      workspace,
      maxBytes: cacheSizeLimitMib * 1024 * 1024,
      readOnly,
      cache: createCacheStore(true, readOnly)
    });
    cacheHit = restored.hit;
    globalCacheDirectory = restored.directory;
  }
  addPath(installation.directory);
  setOutput("version", release.version);
  setOutput("zig-path", installation.directory);
  setOutput("cache-hit", cacheHit);
  setOutput("toolchain-cache-hit", installation.source !== "download");
  setOutput("global-cache-dir", globalCacheDirectory);
  setOutput("sha256", installation.sha256);
  info(
    `Zig ${release.version} is ready (${target.os}/${target.arch}, ${installation.source}).`
  );
}
run().catch((error) => setFailed(getErrorMessage(error)));
