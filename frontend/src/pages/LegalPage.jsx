import React from "react";
import { Link, useLocation } from "react-router-dom";
import LegalFooter from "../components/LegalFooter.jsx";

const LAST_UPDATED = "September 28, 2026 (draft)";

function Terms() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="legal-lede">These terms govern your use of the hosted iii3xnz workflow automation service. Self-hosted copies of the software are governed by the iii3xnz Sustainable Use License in the repository, not by these terms.</p>
      <p className="legal-lede"><strong>Draft notice:</strong> text in [square brackets] is a placeholder that the operator must complete, and these terms must be reviewed by a qualified lawyer before use.</p>
      <h2>1. The service</h2>
      <p>iii3xnz lets you create and run workflows that connect triggers, logic, AI models, and third-party services. We may improve, modify, or discontinue parts of the service, with reasonable notice where practical.</p>
      <h2>2. Your account</h2>
      <p>You are responsible for keeping your account credentials secure and for activity performed through your account. You must provide accurate information and notify us promptly of unauthorized access.</p>
      <h2>3. Acceptable use</h2>
      <p>You may not use iii3xnz to break the law, abuse third-party services, upload malicious code, bypass plan limits, or access another customer&apos;s data. You are responsible for the workflows, credentials, data, and destinations you connect.</p>
      <h2>4. Fair use and resource limits</h2>
      <p>The service runs on shared infrastructure. We may throttle, queue, rate-limit, suspend, or remove workflows and workloads that burden the infrastructure or other customers, and we may do so without prior notice where needed to protect the service. This includes recursive or self-triggering workflows, unbounded or extremely large loops, excessive scraping or crawling, cryptocurrency mining, port scanning or network probing, and load or stress testing that we have not agreed to in writing. Per-execution limits (for example steps, run time, loop iterations, AI calls, tokens, and output size) and concurrency and payload limits apply and may change.</p>
      <h2>5. Prohibited automation and AI misuse</h2>
      <p>You may not use the service to send spam or unsolicited bulk messages, phish or deceive people, evade bot or abuse protections of other services, probe or attack networks or systems, or generate or distribute content that violates the law. When you connect an AI model provider, you must comply with that provider&apos;s usage policies. You are responsible for your own API keys, for the charges your workflows create with those providers, and for reviewing AI output before relying on it. AI output can be wrong; do not use it as the sole basis for legal, medical, financial, or safety decisions.</p>
      <h2>6. No resale or service bureau use</h2>
      <p>You may not resell the service, offer it or workflow execution capacity to third parties as your own service, or operate it as a service bureau, unless we have agreed to that in a separate written commercial agreement. Self-hosted use of the software is governed by the iii3xnz Sustainable Use License, which also restricts hosting, reselling, and white-labeling; see COMMERCIAL-LICENSING.md in the repository.</p>
      <h2>7. Third-party services</h2>
      <p>Workflows may call services operated by third parties. Their availability, terms, pricing, and data practices are controlled by those providers. You authorize iii3xnz to make the requests your workflows instruct it to make.</p>
      <h2>8. Plans, payments, and plan changes</h2>
      <p>Paid plans renew according to the billing interval shown at checkout unless canceled. Payments and applicable taxes are handled by our payment provider. Plan limits and included features are displayed in the application. We will give you at least 30 days’ notice by email or in the application before a change that reduces the limits or features of your current plan takes effect; changes take effect at the start of your next billing period.</p>
      <h2>9. Your content and confidentiality</h2>
      <p>You retain rights to the data and workflow definitions you submit. We do not sell your content, use it to advertise to you, share it with unrelated people or companies, or use it to train AI models. We do not read, inspect, or analyze the content of your workflows or data for any purpose other than operating the service you asked for (running your workflows, providing support you request, and billing). You grant iii3xnz only the limited permission needed to host, secure, process, and transmit that content to operate the service and execute the workflows you configure.</p>
      <p>When a workflow connects to a third-party service, including an AI model provider, data is sent to that service because you instructed the workflow to do so. That provider then handles the data under its own terms and privacy policy, which we do not control. You are responsible for reviewing the destination service and the data your workflow sends.</p>
      <h2>10. Indemnification</h2>
      <p>You will defend and indemnify iii3xnz and its operators against claims, damages, and costs (including reasonable legal fees) arising from your workflows, your content, your connected credentials and destinations, your use of AI providers, or your breach of these terms, except to the extent caused by our own breach or misconduct. This obligation survives termination of your account.</p>
      <h2>11. Availability and liability</h2>
      <p>The service is provided on an &quot;as is&quot; and &quot;as available&quot; basis. To the extent allowed by law, iii3xnz is not liable for indirect, incidental, special, consequential, or lost-profit damages, and its total liability is limited to the amount you paid iii3xnz in the 12 months before the claim arose, or USD 100 if you are on a free plan.</p>
      <h2>12. Termination</h2>
      <p>You may stop using the service at any time. We may suspend or terminate access for violations, security risks, nonpayment, or operational reasons. Provisions that should survive termination will continue to apply.</p>
      <h2>13. Governing law and disputes</h2>
      <p>These terms are governed by the laws of India. Disputes will be resolved by the courts of Mumbai, Maharashtra, India, after first trying in good faith to resolve the matter by contacting us. <em>(Governing law and venue are assumed from the maintainer’s available location and should be confirmed — see LEGAL_REVIEW_NEEDED.md.)</em></p>
      <h2>14. Contact</h2>
      <p>For questions about these terms, contact <a href="mailto:iii3xnz111@gmail.com">iii3xnz111@gmail.com</a>.</p>
    </>
  );
}

function Privacy() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="legal-lede">This policy explains what iii3xnz collects, why we use it, and the choices available to you.</p>
      <h2>1. Information we collect</h2>
      <p>We collect account information such as your email address and password hash, profile information you provide, workflow definitions, execution logs, encrypted credentials, billing identifiers, and support or invitation communications.</p>
      <h2>2. How we use information</h2>
      <p>We use information to provide and secure the service, authenticate accounts, execute workflows, enforce plan limits, process subscriptions, send transactional messages, prevent abuse, troubleshoot failures, and respond to support requests. We do not sell personal information or use workflow content to build advertising profiles.</p>
      <h2>3. Workflow data and credentials</h2>
      <p>Workflow data is processed to perform the actions you configure. Stored credentials are encrypted before database storage. Do not place secrets in workflow names, logs, or messages sent to third-party services.</p>
      <h2>4. When information may be disclosed</h2>
      <p>We do not sell your personal information, rent it, or share it with data brokers or advertisers. We disclose information only in limited circumstances: to trusted providers that host, email, secure, monitor, or process payments for the service; to a third-party integration when your workflow explicitly sends data there; when you ask us to provide support; or when disclosure is required to comply with law, protect safety, prevent fraud, or defend the service.</p>
      <p>Our service providers may process information only to provide their contracted services to iii3xnz. They are not authorized to use your workflow content for their own advertising or unrelated purposes.</p>
      <h2>5. Product improvement and your choice</h2>
      <p>We may use aggregated or de-identified information, such as feature usage, error rates, and performance patterns, to improve reliability and decide which features to build. We do not use the contents of your workflows, credentials, execution payloads, or customer data for product development unless you explicitly provide permission, such as by submitting feedback, a support example, or a case study.</p>
      <h2>6. Retention and security</h2>
      <p>We retain information while your account is active and for the period needed for legal, security, dispute-resolution, and operational purposes. No online service can guarantee absolute security, but we use access controls, encryption, rate limiting, and security monitoring appropriate to the service.</p>
      <h2>7. Your choices</h2>
      <p>You can update your profile, delete credentials, manage billing, and request account or data deletion through support. Some records may need to be retained where required by law or legitimate security needs.</p>
      <h2>8. Cookies and local storage</h2>
      <p>The app uses browser storage for authentication and preferences such as onboarding and the selected workspace. You can clear this storage in your browser, though doing so may sign you out or reset preferences.</p>
      <h2>9. Children and international users</h2>
      <p>The service is not directed to children. If you use iii3xnz from another country, your information may be processed in the countries where our service providers operate.</p>
      <h2>10. Contact</h2>
      <p>For privacy questions or requests, contact <a href="mailto:iii3xnz111@gmail.com">iii3xnz111@gmail.com</a>.</p>
    </>
  );
}

export default function LegalPage() {
  const { pathname } = useLocation();
  const isTerms = pathname === "/terms";
  return (
    <div className="legal-shell">
      <header className="legal-header">
        <Link to="/" className="app-brand">iii3xnz</Link>
        <Link to="/auth">Back to sign in</Link>
      </header>
      <main className="legal-document">
        <div className="legal-meta">Last updated {LAST_UPDATED}</div>
        {isTerms ? <Terms /> : <Privacy />}
        <div className="legal-switch"><Link to={isTerms ? "/privacy" : "/terms"}>{isTerms ? "Read the Privacy Policy" : "Read the Terms of Service"}</Link></div>
      </main>
      <LegalFooter />
    </div>
  );
}
