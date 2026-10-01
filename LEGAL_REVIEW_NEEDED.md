# Legal review needed before release

I am a software assistant, not a lawyer. Every legal document here is a draft, even the parts I've now filled in with real values. A qualified lawyer (ideally with open-source/source-available licensing experience, in India) should review at least the following before you publish anything or rely on these terms.

## Be blunt about what this change cannot do

- **Apache 2.0 versions you already published stay Apache 2.0 forever.** Anyone who has a copy of an earlier release (or a fork of the earlier git history) may keep using, modifying, hosting, and selling it under Apache 2.0, including large cloud vendors. The new license applies only to releases you publish from now on. **You are not protected against copies of code already published under Apache 2.0.** I could not check what was ever public: the uploaded git history has 4 commits, all by one author (iii3xnz), but I cannot see the public repository, its forks, or its download history. Git history was not rewritten.
- **If the repository was never public before now, the risk is much smaller**; confirm this yourself.
- **Contributors:** the uploaded history shows one author, so relicensing should be possible for that code. Any outside contributions made under Apache 2.0 (in the public repo, not visible to me) would need the contributor's consent to relicense their portions.
- This license is "source-available", not open source. It makes some free services unavailable (see the SignPath item below) and some users, companies and package registries will not use it.

## Placeholders I filled in — confirm each one

I filled every remaining `[bracket]` placeholder with a specific, reasoned default rather than leaving it blank, so the documents read as finished, professional text instead of a form. None of these are verified facts about your actual legal situation — they're my best defensible guess, and every one needs your confirmation:

| Value | What I used | Why | Files |
|---|---|---|---|
| Copyright holder | "Ayush Mishra" | The only real name on file (from CODE_SIGNING.md's maintainer line) | LICENSE.md, LICENSE_EE.md |
| Governing law | India | Your approximate location (Mumbai) is the only signal I had | LICENSE.md, LICENSE_EE.md, Terms of Service |
| Courts/venue | Mumbai, Maharashtra, India | Same reasoning as above | LICENSE.md, LICENSE_EE.md, Terms of Service |
| License liability cap | Greater of USD 100 or fees paid in the prior 12 months | Standard, common cap for free/source-available software licenses | LICENSE.md |
| ToS liability cap | Fees paid in the prior 12 months, or USD 100 on the free plan | Standard SaaS cap language | Terms of Service |
| Plan-change notice period | 30 days | Common industry default | Terms of Service |
| Commercial licensing contact | iii3xnz111@gmail.com | The address you gave me | COMMERCIAL-LICENSING.md |
| Commercial pricing | "quoted per request", no fixed numbers | I have no real pricing to publish, and inventing numbers would be worse than saying so | COMMERCIAL-LICENSING.md |

**The governing-law and venue assumption is the one most worth double-checking carefully** — it directly affects which laws apply and where a dispute would be heard, and I inferred it only from an approximate location signal, not anything you told me directly. If you (or the actual legal entity that should hold the copyright) are elsewhere, or if you'd rather incorporate a company to hold the copyright instead of your personal name, these need to change before they're relied on.

Also note: I removed a fabricated email address (`iii3xnzsupport111@gmail.com`) that I invented in an earlier pass and had no basis for. Everything now points to `iii3xnz111@gmail.com`, the one you actually gave me. If you use a different address for legal/support matters, update it in `COMMERCIAL-LICENSING.md` and `frontend/src/pages/LegalPage.jsx`.

## Data-use language

You asked me to strengthen the "we don't use your data" language. I did — the Terms of Service and PRIVACY.md now explicitly commit that any hosted deployment won't sell customer content, won't use it to train AI models, won't share it with unrelated third parties, and won't read/analyze it beyond operating the service. **I did not claim "we collect no information," because that would be false for any functioning hosted product** (an account, workflows, and executions have to be stored somewhere for the app to work), and a false claim like that is itself a legal risk — potentially worse than the concern it's meant to address. Have a lawyer confirm this framing satisfies what you actually want to promise, and that it's consistent with real practice once a hosted version exists.

## New in this round: AI memory and RAG (retrieval) features

Two new features store user-submitted content in the database persistently until deleted:
- **Chat memory** (`ai_chat_memory` table): stores prompts and responses per session, scoped per user, kept only up to a configurable message count (older turns are deleted automatically) but otherwise **kept indefinitely** — there's no automatic time-based expiry.
- **Vector store** (`ai_vector_documents` table): stores whatever text content a workflow chooses to index (e.g., uploaded documents), plus its embedding, **indefinitely** until the workflow or operator deletes it.

Neither feature currently has an automatic retention/expiry policy, a way for an end-user to request deletion of their own data through a UI (deletion is only possible via the database directly or by a workflow explicitly calling the provided clear functions), or a documented data-retention statement in the Privacy Policy naming these specific tables. If this product will process any regulated personal data (health, financial, children's data, or EU/India data-protection-covered personal data) through these features, a lawyer should confirm whether a stated retention period and a user-facing deletion path are required before launch.

## Documents and placeholders to review

| Item | File | What to check |
|---|---|---|
| License text | LICENSE.md | Enforceability, definitions of "Internal Business Purposes", "Hosted Service", "Competing Product"; consultant/agency carve-out; cure period; patent clause; the filled-in governing law/venue/liability cap above |
| Enterprise license | LICENSE_EE.md, EE_FILES.md | Marking approach (header + list), the "no license-key enforcement" position, limited-testing right; the filled-in governing law/venue above |
| Contribution terms | CONTRIBUTING.md | DCO plus relicensing grant; whether a full CLA is preferable |
| Terms of Service | frontend/src/pages/LegalPage.jsx | Fair-use, AI-misuse, no-resale, indemnification, the filled-in liability cap/notice period/governing law above, data-use commitments |
| Privacy policy | PRIVACY.md | The new "Data use commitments" and AI memory/RAG retention gap noted above |
| Trademark | LICENSE.md s.5 | "iii3xnz" name/logo are reserved but not registered anywhere I could check |
| Third-party licenses | THIRD-PARTY-NOTICES.txt | Regenerate after any dependency change; the offline audit found only permissive licenses (MIT, ISC, BSD, Apache-2.0, BlueOak, CC-BY-4.0), except nodemailer had a moderate CVE, now patched (see DECISIONS.md) |

## Not verified

- I did not read the full text of n8n's Sustainable Use License, n8n Enterprise License, Elastic License 2.0, or the Functional Source License. This sandbox has no direct internet access; I only read n8n's documentation summaries through a search tool (see DECISIONS.md). The license here is written from my general knowledge of that style of license, not copied from any of them.
- SignPath Foundation's free signing requires an OSI-approved license with no commercial dual-licensing (https://signpath.org/terms). This project will no longer qualify (see CODE_SIGNING.md).
- I have not verified whether "Ayush Mishra" as an individual, versus a registered company, is the right entity to hold copyright and be named as Licensor — that's a business decision only you can make, ideally with an accountant or lawyer.
