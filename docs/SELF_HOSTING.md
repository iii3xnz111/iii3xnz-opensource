# Self-hosting iii3xnz

## Windows quick start

Use the release `iii3xnz-Setup.exe`. It detects Docker Desktop, uses Docker's
official installer if Docker is missing, starts the Compose stack, waits for
Docker Engine and application readiness, and opens the default browser. UAC,
Docker's license prompt, and an unavoidable Windows restart remain normal
platform requirements. Application uninstall preserves Docker data volumes;
deleting user data is a separate explicit Start Menu action.

## CLI quick start

From the repository root:

```bash
docker compose up -d
```

The Docker setup starts PostgreSQL, the backend, the worker, and the frontend.
The application is served at `http://localhost` and the API is available at
`http://localhost:4000`.

Docker generates JWT and encryption secrets into a persistent named volume on
first boot. For a production deployment, replace this local setup with managed
secret storage and a protected PostgreSQL deployment.

## Configuration

Copy `backend/.env.example` when running outside Docker. Required values include
`DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `APP_URL`, `OAUTH_CALLBACK_URL`,
and `PORT`. Set `SELF_HOSTED=true` to enable unlimited self-hosted entitlements
and disable cloud billing.

## Registering OAuth applications

Self-hosted installations must register their own OAuth applications. The
original hosted application's callback and credentials are not included here and
will not work for arbitrary domains.

### Google

1. Open Google Cloud Console.
2. Create or select a project.
3. Enable the APIs needed by your workflows.
4. Configure the OAuth consent screen.
5. Create an OAuth 2.0 Web application credential.
6. Add your callback URL, for example:
   `https://your-domain.example/api/oauth/callback`
7. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

### Slack

1. Open Slack API and create a new app.
2. Add OAuth scopes required by the Slack nodes.
3. Add `https://your-domain.example/api/oauth/callback` as a redirect URL.
4. Install the app in the intended workspace.
5. Set `SLACK_OAUTH_CLIENT_ID` and `SLACK_OAUTH_CLIENT_SECRET`.

### GitHub

1. Open GitHub Developer Settings.
2. Register a new OAuth App.
3. Set the authorization callback URL to your public callback URL.
4. Choose the scopes required by the GitHub nodes.
5. Set `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`.

### Microsoft

1. Open Microsoft Entra admin center.
2. Register a new application.
3. Add the callback URL as a Web redirect URI.
4. Create a client secret and configure the required delegated permissions.
5. Set `MICROSOFT_OAUTH_CLIENT_ID` and `MICROSOFT_OAUTH_CLIENT_SECRET`.

### HubSpot

1. Open the HubSpot developer portal.
2. Create an app and configure its OAuth scopes.
3. Add your public callback URL.
4. Copy the app client ID and client secret.
5. Set `HUBSPOT_OAUTH_CLIENT_ID` and `HUBSPOT_OAUTH_CLIENT_SECRET`.

## Email

Configure SMTP with `APP_SMTP_HOST`, `APP_SMTP_PORT`, `APP_SMTP_USER`,
`APP_SMTP_PASS`, and `APP_SMTP_FROM`, or configure `BREVO_API_KEY`.
Without an email provider, development mode prints transactional messages to the
backend log and should not be used for a public deployment.

## Data and backups

The application bootstraps its PostgreSQL schema automatically. Use a managed
PostgreSQL service or scheduled `pg_dump` backups for production. Test restores
before relying on a backup policy.

## Security checklist

- Use HTTPS for the frontend, API, and OAuth callback.
- Set unique, securely stored `JWT_SECRET` and `ENCRYPTION_KEY` values.
- Protect PostgreSQL from public access.
- Set `APP_URL` to the exact public frontend origin.
- Set `OAUTH_CALLBACK_URL` to the exact public API callback URL.
- Rotate credentials if a deployment volume or environment is compromised.
- Keep the internal queue endpoint protected with `INTERNAL_CRON_SECRET`.
