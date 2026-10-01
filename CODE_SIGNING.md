# Code signing policy

## Current status

Installers published by `.github/workflows/release.yml` are **unsigned unless signing is configured**. No signed release exists yet, and no certificate is claimed.

## How the release workflow handles signing

- The workflow builds `iii3xnz-Setup.exe`, uploads it as a workflow artifact, and (only when the secret and variables below exist) submits it to SignPath for signing.
- If signing is not configured, or the signing step fails, the release is still published, with an **unsigned build** note in the release body. Signing never blocks a release.
- Every release includes a SHA-256 checksum file.

Configure signing by adding, in GitHub repository settings:

| Kind | Name |
|---|---|
| Secret | `SIGNPATH_API_TOKEN` |
| Variable | `SIGNPATH_ORGANIZATION_ID` |
| Variable | `SIGNPATH_PROJECT_SLUG` |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` |

Never commit tokens, certificates, or private keys.

## Important: SignPath Foundation (free) is not available under this license

SignPath Foundation's free program requires an OSI-approved open-source license without commercial dual-licensing for all components (see https://signpath.org/terms). The iii3xnz Sustainable Use License is source-available, not OSI-approved, and the project also has an Enterprise License and commercial licensing. The project therefore **does not qualify** for the free Foundation certificate, and earlier wording that planned to use it has been removed. Options: buy a code-signing certificate or a commercial SignPath plan, or accept unsigned builds with published checksums. Choosing between them is the maintainer's decision.

## Governance

Maintainer, committer, reviewer and release approver: Ayush Mishra (single-person project; no larger review process is claimed).

## Related documents

- [PRIVACY.md](PRIVACY.md)
- [README.md](README.md)
- [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)
