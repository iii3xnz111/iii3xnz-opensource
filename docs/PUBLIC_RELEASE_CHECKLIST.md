# Public release checklist

This checklist is intended for the maintainer before making the repository public and preparing the first release.

## 1. Final repository security scan
- [ ] No secrets or private credentials remain in the repository
- [ ] No `.env` files remain in the working tree
- [ ] No local node_modules directories are included
- [ ] No local databases or SQLite files remain
- [ ] No logs remain in the repository
- [ ] No private signing keys or certificate files remain
- [ ] No personal machine paths or local test credentials remain
- [ ] No cloud credentials or production deployment secrets remain

## 2. Licensing and notices
- [ ] LICENSE.md (Sustainable Use License) and LICENSE_EE.md are present, consistent with package.json "license" fields, README and file headers
- [ ] A lawyer has reviewed everything in LEGAL_REVIEW_NEEDED.md and all [PLACEHOLDER] values are filled in
- [ ] Nothing in the repository calls the project "open source" (it is fair-code / source-available)
- [ ] THIRD-PARTY-NOTICES.txt is present and complete
- [ ] PRIVACY.md is present
- [ ] CODE_SIGNING.md is present
- [ ] README links point to valid existing documents

## 3. Installer readiness
- [ ] Windows installer build succeeds from source
- [ ] installer metadata is consistent with iii3xnz
- [ ] product version matches the release artifact
- [ ] no private build paths remain in installer metadata
- [ ] official Docker installation flow remains documented
- [ ] user-data removal behavior is clearly separated from uninstall

## 4. Release process
- [ ] GitHub repository is ready to be made public
- [ ] GitHub release notes are prepared
- [ ] release notes state whether the installer is signed or an unsigned build
- [ ] GitHub Release includes the installer and its SHA-256 checksum file

## 5. Code signing decision
- [ ] Decided between paid certificate / commercial SignPath / unsigned builds (SignPath Foundation free signing requires an OSI license; see CODE_SIGNING.md)
- [ ] If signing: secret and variables from CODE_SIGNING.md are configured and a test release was verified

## 6. Final owner actions
- [ ] Repository is pushed and made public
- [ ] GitHub Release is created
- [ ] Release page states signed or unsigned status
- [ ] Download URL is tested
