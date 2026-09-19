# Release notes template

This template is for preparing public GitHub Releases for iii3xnz. It is intentionally written for a future public release and is not a release that has already been published.

## Code signing policy

"Free code signing provided by SignPath.io, certificate by SignPath Foundation"

Official Windows releases for iii3xnz are intended to use SignPath Foundation Open Source Code Signing, subject to acceptance and configuration. This repository and its public release process are prepared for that arrangement.

See:

- [CODE_SIGNING.md](../CODE_SIGNING.md)
- [PRIVACY.md](../PRIVACY.md)
- [README.md](../README.md)
- [THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt)

## Release scope

This release notes template distinguishes between:

- unsigned test or pre-signing artifacts
- official signed release artifacts after SignPath processing

A pre-signing test artifact is not an officially signed release. Official downstream release notes and assets should only reference the final signed installer after SignPath has accepted the build and generated the signed binary.

## Download and distribution

The eventual public GitHub Release location is:

https://github.com/iii3xnz111/iii3xnz-opensource/releases

The repository itself is:

https://github.com/iii3xnz111/iii3xnz-opensource

## Installation notes

- The Windows installer artifact is named iii3xnz-Setup.exe.
- The installer is intended to start Docker Desktop when needed, bootstrap the local stack, and launch the application.
- Operators should review the self-hosting documentation before deploying publicly.
- This release notes template is not a substitute for a signed artifact or release publication.

## Security note

Before public release, confirm that the repository contains no secrets, no local `.env` files, no private keys, no local database dumps, no logs, and no cloud credentials.
