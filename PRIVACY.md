# Privacy policy

This privacy policy describes the actual behavior of the iii3xnz open-source project repository and software as distributed in source form. It is intended to support transparent public release preparation and does not replace local legal review for any deployment.

## 1. Scope

This project is primarily a self-hosted workflow automation platform. The repository includes source code and installer packaging for running iii3xnz on infrastructure operated by the deployer, including PostgreSQL, Docker, a backend API, a worker, and a frontend application.

The project also includes configuration variables for external integrations, authentication providers, email delivery, and optional hosted/cloud billing hooks. Those configuration values are not included in the public repository and are meant to be supplied by the operator in a private local environment.

## 2. Self-hosted iii3xnz

In a self-hosted deployment, the operator controls the environment in which iii3xnz runs. This includes:

- the server or workstation hosting Docker and PostgreSQL
- storage for the PostgreSQL database and application volumes
- deployment environment variables and secrets
- firewall and network access controls
- backup and restore procedures
- authentication provider registration and credentials for OAuth, SMTP, and related integrations
- operator responsibilities for user account management, access control, and lawful processing of data

The project stores workflow data, account data, workspace data, job/execution history, and credentials in a PostgreSQL-backed system when deployed. Generated JWT and encryption secrets are stored in a persistent Docker volume as part of the self-hosted deployment model.

The operator is responsible for infrastructure, backups, access controls, legal compliance, incident response, and retention decisions for that deployment.

## 3. Data handled by the application

The application may handle the following categories of data, depending on how the operator configures and uses the software:

- account information used for sign-in and user management
- authentication data such as password hashes and session tokens
- email and OTP-related verification data
- Google authentication data when configured
- workflow definitions, triggers, actions, and related configuration
- credentials for external services and provider integrations
- execution history, job metadata, and workflow run traces
- workspace/project membership and role information
- logs for local troubleshooting and operational monitoring
- IP and network metadata that may be present in application logs or server records, depending on the deployment environment

This is not a hosted service. The project does not include a built-in multi-tenant cloud product in the public repository.

## 4. Authentication and local browser storage

The frontend uses browser storage for session and remember-me behavior as implemented by the application. The project includes:

- local storage for remember-me preferences and token retention when enabled
- session storage for temporary session state
- JWT-based session handling for authenticated access
- optional Google identity verification
- email and OTP verification flows

The use of browser storage depends on the deployment and the user interaction model. The operator remains responsible for securing the deployment, browser environment, and any credentials or user data stored locally.

## 5. OAuth, email, and external integrations

iii3xnz supports OAuth and API integrations with third-party providers and services. These integrations may involve provider-specific credentials supplied by the operator or by the deployment environment.

Examples include OAuth apps for Google, Slack, GitHub, Microsoft, and HubSpot, and SMTP or API-based email configuration. The project does not include production provider credentials or secret values in the repository.

Third-party provider services also process traffic and data according to their own terms and privacy policies. Users and operators are responsible for reviewing the applicable provider policies for any external integration they enable.

## 6. Logs and operational data

The application may write operational logs to local files or container logs depending on the deployment setup. The project does not claim a centralized hosted telemetry system or cloud analytics backend in the source repository.

For self-hosted deployments, the operator is responsible for log retention, access control, and any privacy or compliance requirements connected to those logs.

## 7. Docker, PostgreSQL, and local storage

The repository includes Docker Compose configuration, PostgreSQL persistence, and self-hosted file/volume storage. This means the operator is responsible for:

- database protection and access restrictions
- volume management and backups
- secret management
- operating system and container security
- operational monitoring and retention

## 8. Data deletion and operator responsibility

Self-hosted installations require the operator to implement appropriate data deletion, retention, backup, and access-control policies. The project does not operate as a hosted SaaS and does not provide a central account-deletion service or managed privacy portal.

## 9. Hosted/cloud considerations

The repository includes configuration placeholders for hosted/cloud billing and optional provider integrations, but it does not ship a hosted production deployment or cloud service configuration. Any hosted/cloud use of iii3xnz would be a separate environment operated by a separate party and would be governed by that operator's own privacy and legal terms.

## 10. Third-party services

The software may connect to third-party services and APIs selected by the operator, including OAuth providers, email providers, and external business/workflow services. Those providers have their own data handling practices and legal terms. This project does not control those third-party services beyond the application integration code and documentation.

## 11. Contact

For repository or release-related questions, use the public GitHub repository and issue tracker:

https://github.com/iii3xnz111/iii3xnz-opensource/issues

For operational or deployment privacy questions, the operator is responsible for the specific deployment and should coordinate with the entity operating that deployment.
