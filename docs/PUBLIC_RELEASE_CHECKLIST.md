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
- [ ] LICENSE is present and still Apache 2.0
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
- [ ] release notes include the SignPath code-signing policy wording
- [ ] final signed installer is available after SignPath processing
- [ ] final SHA-256 is computed for the signed installer
- [ ] GitHub Release includes both the signed installer and the checksum

## 5. SignPath-specific review
- [ ] SignPath application requirements have been reviewed
- [ ] repository URL and release URL are recorded accurately
- [ ] release artifact is the final signed installer
- [ ] final signature is independently verified before public release

## 6. Final owner actions
- [ ] Repository is pushed and made public
- [ ] GitHub Release is created
- [ ] Release page contains the required code-signing wording
- [ ] Download URL is tested
- [ ] SignPath application is submitted with the public URLs
