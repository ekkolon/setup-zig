# setup-zig

Install Zig in GitHub Actions on Linux, macOS, and Windows. Supports releases, version ranges, and development builds. Downloads and cached archives are verified against Zig's minisign release key.

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

Pin Zig to an exact version for reproducible builds. For stronger supply-chain guarantees, pin the action to a commit SHA instead of `v1`.

## Versions

| Value | Installs |
| --- | --- |
| `0.17.0` | Exact release |
| `0.17.x` | Latest matching release |
| `>=0.16.0 <0.18.0` | Latest release in the range |
| `latest` | Latest stable release (default) |
| `master` | Current development build |
| `0.18.0-dev.35+5e754304d` | Exact development build, if still available |

Zig 0.7.0 and newer are supported where a signed binary exists for the selected platform. Ranges select stable releases. Development versions retain their full commit hashes.

You can also read the version from `.zigversion`, `.tool-versions`, or `build.zig.zon`:

```yaml
- uses: actions/checkout@v7
- uses: ekkolon/setup-zig@v1
  with:
    version-file: .zigversion
```

A plain version file contains one version or range. `.tool-versions` uses the `zig` entry; `build.zig.zon` uses the top-level `minimum_zig_version` as an exact version. An explicit `version` takes precedence over `version-file`.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `version` | `latest`¹ | Release, range, or development build |
| `version-file` | | File containing the Zig version |
| `architecture` | Runner architecture | `x64`, `arm64`, or `x86` |
| `check-latest` | `false` | Refresh the version index for ranges and `master` |
| `checksum` | | Additional archive SHA-256 verification |
| `mirror` | Community mirrors | Exclusive HTTPS mirror URL |
| `cache` | `true` | Cache Zig's global build directory |
| `cache-toolchain` | `true` | Cache signed compiler archives and metadata |
| `cache-read-only` | `false` | Restore caches without uploading |
| `cache-key` | | Additional build-cache scope |
| `cache-dependency-path` | `**/build.zig.zon` | Dependency-file globs, one per line |
| `cache-size-limit` | `2048` | Maximum build-cache upload size in MiB |

¹ Used only when neither version input is set.

## Caching

Compiler archives are restored from the runner tool cache or GitHub Actions cache before downloading from a mirror. Every archive is signature-verified before extraction, including cache hits.

The global Zig cache is restored before the build and saved after a successful job. Cache keys separate Zig versions, platforms, and optional project scopes. Disable it with `cache: false`; use `cache-toolchain: false` to disable remote archive and metadata caching. Cache failures do not prevent installation.

See [advanced usage](docs/advanced-usage.md) for cache keys, mirror behavior, monorepos, and matrix builds.

## Outputs

| Output | Description |
| --- | --- |
| `version` | Exact installed version |
| `zig-path` | Directory containing `zig` |
| `sha256` | Verified archive SHA-256 |
| `toolchain-cache-hit` | Archive restored from a cache |
| `cache-hit` | Exact build-cache match |
| `global-cache-dir` | Configured Zig global cache directory |

## Requirements

Linux, macOS, and Windows are supported on x64 and arm64. Linux and Windows also support x86 when a compatible Zig binary and host are available. `architecture` selects the compiler executable, not the compilation target.

The action uses Node 24 supplied by the Actions runner. Self-hosted runners need version 2.327.1 or later. Linux and macOS require `tar` with xz support; Windows requires PowerShell. No Node installation step or GitHub token input is needed.

Release archives have signed provenance, a CycloneDX SBOM, and immutable release attestations. See [release verification](SECURITY.md#release-provenance).

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [License](LICENSE)
