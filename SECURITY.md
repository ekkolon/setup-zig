# Security

Report vulnerabilities privately through [GitHub's vulnerability reporting form](https://github.com/ekkolon/setup-zig/security/advisories/new). Do not include credentials in reports.

Security fixes are released for the latest major version.

## Download verification

The action verifies prehashed minisign signatures with the Zig release public key embedded in the source. It also verifies the signature on the trusted comment and checks that its filename matches the requested version and platform. Node's crypto implementation provides Ed25519 and BLAKE2b-512. Verification cannot be disabled.

Signed archives are cached rather than extracted executables. Every restored archive is verified before extraction. Archive size and SHA-256 are checked when supplied by the version index; an explicit `checksum` adds the same check to an exact pin. Invalid cached archives are ignored. Extracted compilers must report the requested version before being added to PATH.

The Zig release key and the action revision are trust anchors. Version metadata is fetched over HTTPS and stored within GitHub's cache scope. Pin an exact Zig version to avoid mutable version selection, and pin the action to a full commit SHA.

## Runner and cache trust

GitHub's normal cache access rules apply. Build caches contain unsigned compiler output and packages, so treat them as workflow data. Use `cache: false` for jobs that must rebuild without restored build data. `cache-read-only` prevents this action from uploading caches; it does not make restored data trusted.

Self-hosted runners must isolate jobs of different trust levels. This action does not protect a job from another process that can modify the runner's files or environment. Do not run untrusted pull-request code in a privileged `pull_request_target` job.
