# Versioning Notes

MailPilot uses semantic versioning tags:

- `MAJOR`: breaking compatibility changes
- `MINOR`: backward-compatible feature additions
- `PATCH`: backward-compatible fixes and cleanup

Examples:

- `v1.0.0`
- `v1.1.0`
- `v1.1.2`

## Tag Rules

- Tags are created from `main` only.
- Do not retag an existing version.
- Use annotated tags (`git tag -a`), then push to origin.

## Suggested Mapping

- Cleanup/documentation-only release: patch bump
- New user-facing pages/features: minor bump
- Contract-breaking API or storage changes: major bump

