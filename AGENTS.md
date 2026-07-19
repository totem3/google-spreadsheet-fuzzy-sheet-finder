# Repository Guidelines

## Commit and pull request conventions

- Follow Conventional Commits for every commit and pull request title.
- Use `<type>(<optional scope>)!: <description>`.
- Allowed types are `feat`, `fix`, `deps`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, and `revert`.
- Use `feat` for user-visible functionality and `fix` for bug fixes.
- Mark breaking changes with `!` or a `BREAKING CHANGE:` footer.
- Keep the description concise, in English, and starting with a lowercase character.
- Use squash merge and preserve the pull request title as the merge commit subject.

## Verification

- Run `npm test` after changing JavaScript, manifests, or release configuration.
- Never include the local `.agents/` directory in commits.
