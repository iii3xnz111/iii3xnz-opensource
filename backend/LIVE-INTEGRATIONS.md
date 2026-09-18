# Optional live integration tests

The normal test suite never calls third-party APIs. The live smoke tests in `src/test/live/integrations.live.test.js` run only when both environment guards are set:

```text
RUN_LIVE_INTEGRATION_TESTS=true
LIVE_INTEGRATION_ENV=sandbox
```

Set provider-specific variables in the local shell or a private test-only environment. Do not commit them, put them in source files, or use production resources:

- `LIVE_GITHUB_TOKEN` and `LIVE_GITHUB_REPOSITORY`
- `LIVE_STRIPE_SECRET_KEY`
- `LIVE_SLACK_TOKEN`
- `LIVE_PROVIDER_ACKNOWLEDGED=true` for providers requiring a separately managed sandbox resource

Run from `backend`:

```text
node --test src/test/live/integrations.live.test.js
```

The harness uses short request timeouts, does not print response bodies or credentials, and requires an explicit sandbox/test environment marker. Google, Microsoft, HubSpot, Shopify, and Teams need provider-specific test resources and are intentionally represented as an explicit configuration check rather than making unscoped live requests.
