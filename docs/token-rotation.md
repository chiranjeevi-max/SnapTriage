# Token and Secret Rotation

This project supports rotation of PAT and OAuth tokens without downtime:

1. Issue a new token through the provider.
2. Store it via the normal PAT flow (the `accessTokens` table upserts by
   `(userId, provider)`).
3. Confirm login/sync succeeds for all users.
4. Revoke the old provider token.

`AUTH_SECRET` and `AUTH_SALT` require a staged rollout because they derive the
session and token encryption keys. Rotate them by starting a new deployment with
the new values and requiring users to re-authenticate.
