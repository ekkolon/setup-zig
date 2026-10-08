# setup-zig

Set up Zig in GitHub Actions on Linux, macOS, and Windows.

Downloads come from [Zig community mirrors](https://ziglang.org/download/community-mirrors/). Every compiler archive is verified with the Zig release key before extraction, including archives restored from cache.

## Usage

```yaml
name: Test

on: [push, pull_request]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: ekkolon/setup-zig@v1
        with:
          version: '0.17.0'
      - run: zig build test
```

Pin the action to a full commit SHA when you need an immutable dependency. Pin Zig to an exact version for reproducible builds.

## Versions

| Input | Installs |
| --- | --- |
| `0.17.0` | An exact release |
| `0.17.x` | The newest matching release |
| `>=0.16.0 <0.18.0` | The newest release in a range |
| `latest` | The newest stable release (default) |
| `master` | The current development build |
| `0.18.0-dev.35+5e754304d` | An exact development build, while available from mirrors |

Zig 0.7.0 and newer are supported where Zig publishes a signed binary for the requested platform. Ranges select stable releases. The action preserves the full commit hash in development versions.

To keep the version in your repository:

```yaml
- uses: actions/checkout@v7
- uses: ekkolon/setup-zig@v1
  with:
    version-file: .zigversion
```

A plain version file contains one version or range. `.tool-versions` reads the `zig` entry. `build.zig.zon` reads the top-level `minimum_zig_version` as an exact version; it does not choose a newer compiler. `version` takes precedence when both inputs are set.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `version` | `latest`* | Release, range, or development build |
| `version-file` | | Version file relative to the workspace |
| `architecture` | Runtime architecture | `x64`, `arm64`, or `x86` |
| `check-latest` | `false` | Refresh the index before resolving a range or `master` |
| `checksum` | | Additional SHA-256 archive checksum |
| `mirror` | Community mirrors | Use a single HTTPS mirror |
| `cache` | `true` | Cache Zig packages and global compilation results |
| `cache-toolchain` | `true` | Cache signed archives and download metadata in Actions cache |
| `cache-read-only` | `false` | Restore Actions caches without uploading new entries |
| `cache-key` | | Additional build-cache scope, useful for matrix jobs |
| `cache-dependency-path` | `**/build.zig.zon` | Dependency-file globs, one per line |
| `cache-size-limit` | `2048` | Maximum build-cache upload size in MiB |

\* `latest` is used only when neither version input is set.

## Caching

Compiler archives are reused from the runner tool cache, then GitHub Actions cache, before trying a mirror. Both the archive signature and its signed filename are checked on every use. An optional checksum is also checked on cache hits.

Exact pins do not request the version index. Ranges and `master` share an index cached for one hour; `check-latest: true` refreshes it immediately. The mirror list is cached for one day and fetched only when an archive download is needed. Refreshes use HTTP validators when available. There is no automatic compiler-download fallback to ziglang.org.

Build caching sets `ZIG_GLOBAL_CACHE_DIR` to a directory managed by the action. Keys include the platform, full compiler version, `cache-key`, dependency-file contents, and commit. A miss can reuse an older cache for the same platform, compiler, and scope. New entries are saved after successful jobs. Exact hits are not uploaded again. Caches over the size limit are left on disk and skipped.

Set `cache: false` to manage Zig's build cache yourself. Compiler and metadata caching remain enabled. Set `cache-toolchain: false` to disable those Actions caches too; the runner tool cache is still used. Cache service failures produce warnings and do not prevent installation.

## Outputs

| Output | Description |
| --- | --- |
| `version` | Exact installed version |
| `zig-path` | Directory containing `zig` |
| `sha256` | SHA-256 of the verified archive |
| `toolchain-cache-hit` | `true` when the compiler archive was cached |
| `cache-hit` | `true` for an exact build-cache match |
| `global-cache-dir` | Configured global cache directory |

## Runners

Linux, macOS, and Windows are supported on x64 and arm64. Linux and Windows also accept `architecture: x86` when Zig provides a binary and the host can run it. `architecture` selects the compiler executable, not a compilation target; use Zig's `-Dtarget` option for cross-compilation.

The action runs on Node 24, supplied by the Actions runner. Self-hosted runners need runner version 2.327.1 or newer. Linux and macOS need `tar` with xz support; Windows needs PowerShell. Actions caching also requires the tools described in [actions/cache](https://github.com/actions/cache#usage). No separate Node installation or GitHub token input is needed.

[More examples](docs/advanced-usage.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [License](LICENSE)
