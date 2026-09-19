# Code signing policy

This repository is prepared for the intended public release of iii3xnz as a self-hostable Windows desktop installer distributed through GitHub Releases. The project is intended to use the SignPath Foundation Open Source Code Signing program for official Windows releases, subject to SignPath Foundation acceptance and configuration.

## Intended release model

- Project: iii3xnz
- Source repository: https://github.com/iii3xnz111/iii3xnz-opensource
- Windows artifact: iii3xnz-Setup.exe
- Distribution: GitHub Releases
- Intended signing arrangement: SignPath Foundation Open Source Code Signing

The signed Windows installer is built from the repository source and build configuration described in the project documentation and installer scripts. The project does not claim that a SignPath certificate has already been issued or that a signed release has already been published.

## SignPath wording

"Free code signing provided by SignPath.io, certificate by SignPath Foundation"

The project intends to use this arrangement for official Windows releases only after SignPath Foundation accepts the project and the signing workflow is configured.

## Current status

iii3xnz intends to use the SignPath Foundation Open Source Code Signing program for official Windows releases, subject to SignPath Foundation acceptance and configuration.

No release has been signed yet, no certificate has been issued by the project as part of this repository, and no public release approval is claimed.

## Repository and release governance

The repository is intended to be published as a public open-source project with release artifacts served from GitHub Releases. The project owner and maintainer is:

- Ayush Mishra

Committers / maintainers:
- Ayush Mishra

Reviewers:
- Ayush Mishra

Approver:
- Ayush Mishra

This reflects the current maintainer structure in the repository and does not claim a larger formal review process than the project currently has.

## Release materials and documentation

The public repository should include the following before release:

- this code-signing policy
- the privacy policy at [PRIVACY.md](PRIVACY.md)
- the release notes template at [docs/RELEASE_NOTES_TEMPLATE.md](docs/RELEASE_NOTES_TEMPLATE.md)
- the installer build output produced from source
- the final signed installer replacing the unsigned pre-signing artifact after SignPath signing

## Important limitation

This document reflects the project's intended signing arrangement and repository preparation only. Acceptance, verification, certificate issuance, and final signing remain external to this repository and are controlled by SignPath Foundation and the GitHub release process.

## Related documents

- [PRIVACY.md](PRIVACY.md)
- [README.md](README.md)
- [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)
