# Security

Report vulnerabilities privately through [GitHub's vulnerability reporting form](https://github.com/ekkolon/setup-zig/security/advisories/new). Do not include credentials in reports.

Security fixes are released for the latest major version.

## Download verification

The action verifies prehashed minisign signatures with the Zig release public key embedded in the source. It also verifies the signature on the trusted comment and checks that its filename matches the requested version and platform. Node's crypto implementation provides Ed25519 and BLAKE2b-512. Verification cannot be disabled.

Signed archives are cached rather than extracted executables. Every restored archive is verified before extraction. Archive size and SHA-256 are checked when supplied by the version index; an explicit `checksum` adds the same check to an exact pin. Invalid cached archives are ignored. Extracted compilers must report the requested version before being added to PATH.

The Zig release key and the action revision are trust anchors. Version metadata is fetched over HTTPS and stored within GitHub's cache scope. Pin an exact Zig version to avoid mutable version selection, and pin the action to a full commit SHA.

## Release provenance

Versioned releases are immutable. GitHub attests the release tag, source commit, and uploaded assets. The release workflow also generates signed SLSA build provenance and a CycloneDX SBOM attestation for the attached archive. The SBOM covers production npm dependencies bundled in the action, not Zig itself or development tools.

Verify a release and its downloaded archive with the GitHub CLI:

```sh
gh release verify v1.0.0 -R ekkolon/setup-zig
gh release download v1.0.0 -R ekkolon/setup-zig --pattern 'setup-zig-*.tar.gz'
gh release verify-asset v1.0.0 setup-zig-v1.0.0.tar.gz -R ekkolon/setup-zig
gh attestation verify setup-zig-v1.0.0.tar.gz -R ekkolon/setup-zig \
  --signer-workflow ekkolon/setup-zig/.github/workflows/release.yml
gh attestation verify setup-zig-v1.0.0.tar.gz -R ekkolon/setup-zig \
  --signer-workflow ekkolon/setup-zig/.github/workflows/release.yml \
  --predicate-type https://cyclonedx.org/bom
```

The release also provides `sbom.cdx.json` and `SHA256SUMS`. The `v1` major tag intentionally moves to compatible releases; pin a full action commit SHA or an immutable version tag when evaluating a fixed dependency. Attestations identify the publishing workflow and artifacts, but do not certify that the code is vulnerability-free or compliant with a particular standard.

## Code scanning

CodeQL analyzes maintained source in `src/`, `scripts/`, and `test/`. The generated `dist/` bundles include third-party libraries; CI checks that they reproduce from the lockfile and audits dependencies, including build tools. Review findings in bundled code against their upstream context before treating them as vulnerabilities.

## Runner and cache trust

GitHub's normal cache access rules apply. Build caches contain unsigned compiler output and packages, so treat them as workflow data. Use `cache: false` for jobs that must rebuild without restored build data. `cache-read-only` prevents this action from uploading caches; it does not make restored data trusted.

Self-hosted runners must isolate jobs of different trust levels. This action does not protect a job from another process that can modify the runner's files or environment. Do not run untrusted pull-request code in a privileged `pull_request_target` job.
