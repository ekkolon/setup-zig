# Contributing

Use Node 24 and pnpm 12. Install dependencies and run the local checks:

```sh
pnpm install --frozen-lockfile
pnpm run check
```

Follow the [Google TypeScript style guide](https://google.github.io/styleguide/tsguide.html). Run `pnpm run format` before committing. Use descriptive names and document non-obvious contracts with concise JSDoc; use line comments to explain implementation decisions. Avoid repeating what the types and code already say.

Commit `dist/` whenever source or runtime dependencies change. Consumers run these bundles directly without installing npm packages. CI rebuilds them and checks for differences. Bundled dependency licenses are generated alongside the code.

Unit tests use Node's test runner and make no network requests. To test a real download, signature verification, extraction, and offline reuse of the runner cache:

```sh
node scripts/smoke.mjs 0.17.0
```

`SETUP_ZIG_TEST_MIRROR` can select a community mirror for this check. Integration jobs exercise the bundled action on Linux, macOS, and Windows. The full matrix also covers arm64 Linux and Windows and Intel macOS.

Keep the input surface small. Add a regression test for changes to version resolution, verification, and cache behavior. Do not bypass verification to support a new download source.

## Releases

1. Update the version in `package.json`. Refresh the lockfile only if dependencies change; rebuild `dist/` and merge.
2. Make the repository public, enable immutable releases and private vulnerability reporting, then run the **Release** workflow from `main` with a tag such as `v1.0.0`.
3. The workflow runs the full test matrix, generates a release archive, CycloneDX SBOM, checksums, and signed attestations, then publishes the immutable version tag and release. The workflow confirms the published release is immutable before advancing the matching major tag (for example, `v1`).

Verify the release and its assets as described in [Security](SECURITY.md#release-provenance). Publish the action to GitHub Marketplace from the release page if desired. Version tags are immutable; major tags follow compatible updates.
