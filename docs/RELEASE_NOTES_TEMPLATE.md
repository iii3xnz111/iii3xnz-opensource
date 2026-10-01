# Release notes template

This template is for reviewing GitHub Releases for iii3xnz. Releases are named `<UTC date>-build.<run number>` and created by the manually triggered release workflow.

## Code signing

The release workflow publishes the release notes automatically. State plainly whether the installer is signed. If it is not, say "Unsigned build" and include the SHA-256. See [CODE_SIGNING.md](../CODE_SIGNING.md).

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
