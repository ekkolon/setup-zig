# Advanced usage

## Test multiple versions and platforms

```yaml
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        zig: ['0.16.0', '0.17.0', master]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: ekkolon/setup-zig@v1
        with:
          version: ${{ matrix.zig }}
      - run: zig build test
```

Platform and compiler version are already part of the cache key. When several jobs use the same platform and compiler with different build configurations, give each configuration its own scope:

```yaml
- uses: ekkolon/setup-zig@v1
  with:
    version: '0.17.0'
    cache-key: ${{ matrix.optimize }}
- run: zig build test -Doptimize=${{ matrix.optimize }}
```

## Monorepos

Check out the repository before reading a version file or hashing dependencies. Paths are relative to the workspace, including when later `run` steps set `working-directory`.

```yaml
- uses: ekkolon/setup-zig@v1
  with:
    version-file: packages/server/build.zig.zon
    cache-key: server
    cache-dependency-path: |
      packages/server/build.zig.zon
      packages/shared/build.zig.zon
- run: zig build test
  working-directory: packages/server
```

## Read-only caches

```yaml
- uses: ekkolon/setup-zig@v1
  with:
    version: '0.17.0'
    cache-read-only: ${{ github.event_name == 'pull_request' }}
```

This input affects archive, metadata, and build uploads. GitHub's cache permissions and repository policy still apply. Build-cache restore prefixes never cross compiler versions, architectures, or `cache-key` scopes.

The global cache contains dependency downloads and compiler output. The action does not cache `.zig-cache`, `zig-out`, or arbitrary project paths. Do not put credentials or other secrets in the global cache. Fork pull requests may read caches from the base branch under GitHub's normal cache rules.

## A specific mirror

```yaml
- uses: ekkolon/setup-zig@v1
  with:
    version: '0.17.0'
    mirror: https://pkg.hexops.org/zig
```

A custom mirror is exclusive: if it fails, installation fails unless a verified archive is already cached. The mirror must serve the archive and its `.minisig` file. Signatures always use the Zig release key bundled with the action.

Without an override, the published mirror list is shuffled and up to five mirrors are tried. Network requests have timeouts and size limits. A cached mirror list can be used for up to seven days if refreshing it fails; expired version metadata fails instead of silently selecting an old release. Cold starts need ziglang.org for metadata unless an exact version and a custom mirror are supplied.

Proxy settings supported by the GitHub Actions HTTP client apply to downloads. HTTPS certificate validation remains enabled.

## Read the installed version

```yaml
- uses: ekkolon/setup-zig@v1
  id: zig
  with:
    version: '0.17.x'
- run: zig version
```

`${{ steps.zig.outputs.version }}` contains the exact version. `toolchain-cache-hit` describes compiler reuse; `cache-hit` describes an exact build-cache match. Neither output is a reason to skip your build or tests.
