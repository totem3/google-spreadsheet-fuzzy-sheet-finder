# Release Automation Design

## Summary

Adopt Release Please with Conventional Commits to automate version bumps, changelog maintenance, Git tags, and GitHub Releases for the Chrome extension.

The repository will remain a single-package, non-published Node project. Releases update both `package.json` and `manifest.json`, but do not publish an npm package.

## Goals

- Generate and maintain `CHANGELOG.md` from reviewed changes.
- Keep `package.json` and `manifest.json` versions synchronized.
- Derive release versions from Conventional Commit-compatible pull request titles.
- Review version and changelog changes in a release pull request before publishing.
- Publish `v<version>` Git tags and GitHub Releases when a release pull request is merged.
- Prevent workflows from executing for external contributors until a maintainer explicitly approves them.
- Record the commit convention for Codex, human contributors, and other automation.

## Non-goals

- Publishing the package to npm or another package registry.
- Packaging or submitting the extension to the Chrome Web Store.
- Automatically merging release or dependency pull requests.
- Running privileged workflows against untrusted pull request code.

## Repository State

- The current version is `0.1.0` in both `package.json` and `manifest.json`.
- The project is a private Node package with no package publication step.
- The default branch is `main`.
- Pull request #2 was merged into `main` as merge commit `18e7c1444fc4dfbe0cd51cbd941d8cb07c3362bc`.
- The release automation is developed separately on branch `chore/release-automation`.
- Commit `2766262d566dc05a03473a3bcecdd67dffbd36e6` is the bootstrap boundary immediately before the merged feature history.
- The existing commit history already predominantly follows Conventional Commits.

## Commit and Pull Request Convention

All commits and pull request titles use this format:

```text
<type>(<optional scope>)!: <description>
```

Supported types are:

- `feat`: user-visible functionality; normally causes a minor release.
- `fix`: bug fix; normally causes a patch release.
- `deps`: dependency update; normally causes a patch release when recognized by Release Please.
- `docs`: documentation-only change.
- `refactor`: code restructuring without a behavior change.
- `test`: test-only change.
- `chore`: repository maintenance.
- `ci`: continuous integration change.
- `build`: build-system change.
- `revert`: revert of an earlier change.

A `!` after the type or scope, or a `BREAKING CHANGE:` footer, marks a breaking change. Scopes are optional. Descriptions use concise English and start with a lowercase character.

Pull requests are squash merged. GitHub must be configured to use the pull request title as the default squash commit message so the validated title becomes the commit that Release Please parses on `main`.

The separate release automation pull request will use this title:

```text
chore: configure release automation
```

Pull request #2 was merged without a `feat:` commit on `main`, so its `fix:` history would normally produce `0.1.1`. To preserve the approved initial version without leaving a persistent configuration override, the release automation pull request body ends with this Release Please footer:

```text
Release-As: 0.2.0
```

GitHub is configured to include the pull request body in the squash commit message. Release Please reads this one-time footer from the merge commit and proposes `0.2.0`; subsequent releases use the normal Conventional Commit rules.

## Contributor Guidance

Two documentation layers serve different audiences:

- `AGENTS.md` contains concise, mandatory repository instructions for Codex, including the Conventional Commits rule, squash-merge expectation, and a pointer to contributor documentation.
- `CONTRIBUTING.md` is the canonical human-facing guide with allowed types, examples, release effects, and the pull request workflow.

The root `AGENTS.md` applies to the whole repository. `.codex/rules` is not used for commit conventions because Codex rules files control command execution policy rather than project instructions.

## Pull Request Title Validation

A GitHub Actions workflow validates ordinary pull request titles with `amannn/action-semantic-pull-request`.

The workflow:

- Uses the `pull_request` event, not `pull_request_target`.
- Runs for opened, reopened, edited, and synchronized pull requests.
- Validates the explicit type allowlist and lowercase-starting description.
- Uses only read permissions.
- Does not check out or execute pull request code.
- Pins third-party actions to full commit SHAs with version comments.

The `Validate PR title` check should be required for ordinary pull requests after the workflow is present on `main`.

Release Please pull requests are trusted bot output and are exempt from this requirement. With the default `GITHUB_TOKEN`, GitHub does not trigger a second workflow from a pull request created by Release Please. `main` branch protection therefore sets `enforce_admins` to `false`: after a maintainer manually inspects a trusted Release Please pull request, an administrator intentionally uses the branch-protection bypass to merge it despite the absent bot-triggered check. Ordinary pull requests must still pass `Validate PR title`.

## External Contributor Workflow Approval

The repository Actions setting `Approval for running fork pull request workflows from contributors` is set to `Require approval for all external contributors` (`all_external_contributors`).

As a result:

- Repository owners and members can trigger workflows normally.
- External fork pull requests create an awaiting-approval record, but no runner job starts until a maintainer approves the workflows.
- External fork workflows receive neither write tokens nor repository secrets.
- Users without write access cannot create branches inside the repository.

The only approved automated actors are:

- `dependabot[bot]`, whose pull request workflows run with GitHub's Dependabot restrictions, including a read-only token and no ordinary Actions secrets.
- Release Please, whose pull requests are created with the repository `GITHUB_TOKEN` and therefore do not recursively trigger other workflows.

No other bot is added to an allowlist.

## Release Please Configuration

The implementation adds:

- `.github/workflows/release-please.yml`
- `release-please-config.json`
- `.release-please-manifest.json`

The manifest records the current root package version as `0.1.0`. The configuration uses the Node release strategy for the repository root and sets the initial `bootstrap-sha` to `2766262d566dc05a03473a3bcecdd67dffbd36e6`, limiting the first changelog to changes made after the current default-branch baseline.

Release Please updates:

- `package.json` through the Node release strategy.
- `manifest.json` through an `extra-files` JSON updater targeting `$.version`.
- `CHANGELOG.md` through its standard changelog writer.
- `.release-please-manifest.json` as release state.

Tags use the `v<version>` form without a component prefix. The GitHub Action runs on pushes to `main` with the minimum permissions required to manage release pull requests, tags, labels, and GitHub Releases. It uses the default `GITHUB_TOKEN`; no personal access token or custom secret is introduced.

Merging a release pull request creates the Git tag and published GitHub Release. It does not publish to npm.

## First Release Flow

1. Add the release automation and contribution rules on branch `chore/release-automation`.
2. Open a separate pull request titled `chore: configure release automation` whose body ends with `Release-As: 0.2.0`.
3. Verify tests, configuration files, workflow syntax, pull request title, footer, and diff.
4. Configure squash merge to use the pull request title and body, then squash merge the release automation pull request.
5. Release Please opens or updates a release pull request for `0.2.0`.
6. Review that release pull request for:
   - `package.json` version `0.2.0`.
   - `manifest.json` version `0.2.0`.
   - A `CHANGELOG.md` entry describing the previous-sheet selection feature.
7. Merge the release pull request.
8. Confirm creation of the `v0.2.0` tag and GitHub Release.

## Dependency Maintenance

Dependabot checks GitHub Actions dependencies weekly. Action references remain pinned to immutable commit SHAs, and Dependabot proposes reviewed updates when upstream versions change. Dependency pull requests are not automatically approved or merged.

## Security Considerations

- Avoid `pull_request_target` for contributor-triggered workflows.
- Do not check out or execute untrusted pull request code in the title-validation workflow.
- Grant each workflow only the permissions it needs.
- Do not expose ordinary repository secrets to fork pull requests or Dependabot pull requests.
- Pin third-party actions to immutable commit SHAs.
- Require explicit maintainer approval before any external-contributor workflow receives a runner.
- Keep Release Please on the default `GITHUB_TOKEN` to avoid introducing a long-lived personal access token.

## Verification

Before pushing the implementation:

- Run `npm test`.
- Validate all JSON files, including the Release Please manifest and configuration.
- Validate GitHub Actions workflow syntax and inspect effective permissions.
- Confirm that `manifest.json` is configured as the extra JSON version file.
- Confirm all third-party Actions are pinned to full commit SHAs.
- Confirm `.agents/` and other unrelated files are absent from the diff and commit.

After pushing:

- Confirm the title-validation workflow succeeds for the release automation pull request.
- Read back the repository approval policy and confirm it is `all_external_contributors`.
- Confirm the pull request title and diff match this design.

After merging the release automation pull request:

- Confirm Release Please creates the `0.2.0` release pull request.
- Confirm both version files and `CHANGELOG.md` are correct before merging it.
- Confirm the `v0.2.0` tag and GitHub Release after merging the release pull request.

## Failure Handling

- If Release Please proposes `0.1.1`, verify that the release automation squash commit body contains `Release-As: 0.2.0` and that the bootstrap manifest is `0.1.0`.
- If old commits appear in the first changelog, verify the configured full `bootstrap-sha`.
- If `manifest.json` is not updated, verify the `extra-files` path, updater type, and JSONPath.
- If a normal pull request title check does not run, verify the `pull_request` event configuration and required-check settings.
- If an external contributor workflow runs without approval, re-check the repository Actions approval policy and ensure no workflow uses `pull_request_target`.
- If a Release Please pull request does not run other CI, treat that as the expected behavior of the default `GITHUB_TOKEN` design.
