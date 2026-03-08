# Security Notes

## Local Credentials and Secrets

- The MailPilot local password is app-local only. It is not your Gmail password and should never be logged or committed.
- The Google OAuth desktop client JSON must live outside the repository. Default Windows location:

```text
%LOCALAPPDATA%\MailPilot\google-oauth-client.json
```

- If you do not want to use the default path, set:

```powershell
$env:MAILPILOT_GOOGLE_OAUTH_CLIENT_JSON="${env:LOCALAPPDATA}\MailPilot\google-oauth-client.json"
```

- `MAILPILOT_TOKEN_KEY_B64` is the stable token-encryption key. Treat it like a secret. In dev, MailPilot may generate a local `token_key.b64` file under `%LOCALAPPDATA%\MailPilot\`; do not commit that file.

## Logging Policy

- Do not log access tokens, refresh tokens, OAuth client secrets, auth headers, recovery codes, or raw attachment bytes.
- Avoid logging full local machine paths when a sanitized file name or relative path is enough.
- Do not capture raw Gmail MIME payloads in tracked debug files.

## Runtime Data Locations

Packaged and local runtime data should be treated as machine-local:

- `%LOCALAPPDATA%\MailPilot\cache`
- `%LOCALAPPDATA%\MailPilot\logs`
- `%LOCALAPPDATA%\MailPilot\token_key.b64`
- copied OAuth client JSON files under `%LOCALAPPDATA%\MailPilot\`

These files support local runtime behavior. They belong in local app data, not in Git.
