# @shrug/forgejo — Next Steps

Local: `2026.09.29.2` (unpublished)
Covers: read queries + confirm-gated writes (repos, deploy keys, collaborators,
teams, issues/comments, users, **labels**, **milestones**, issue label/milestone/
assignee association, **create_pull**).

## Added in 2026.09.29.2

- **`create_pull`** — open a pull request (POST /pulls; `head`/`base`/`title`
  required, `base` not defaulted; optional `labels`/`milestone`/`assignees`).
  Bare confirm-gated create; verify-first with `list_pulls` (Forgejo also rejects
  duplicate open head->base PRs). `PullRequestSchema` extended additively with
  `milestone`/`assignees` so the association is visible in the snapshot; the
  state-dependent PR fields are `nullish` to avoid a post-mutation parse-throw on
  the create response. Reviewers (separate endpoint), `merge_pull`,
  `allow_maintainer_edit`, and `due_date` are deferred.

## Added in 2026.09.29.1

- **Surface issue milestone + assignees.** `IssueSchema` now includes `milestone`
  (nullable) and `assignees` (array) — previously stripped, which made a
  successful milestone/assignee association look like a no-op in snapshots even
  though the forge attached it. Applied on create_issue/edit_issue/get_issue/
  list_issues (with embedded-milestone date-sentinel normalization).
- **`edit_issue` assignees.** New `assignees` input (array<string>): omit to
  leave unchanged, `[]` to clear, `[names]` to replace — matching Gitea's
  EditIssueOption. (create_issue already supported assignees.)

## Shipped in 2026.09.28.1 (superseded by 2026.09.29.1; never published)

- **Labels:** `list_labels`, `create_label` (bare confirm-gated create; anchored
  hex color; driver verifies-first).
- **Milestones:** `list_milestones`, `create_milestone` (bare confirm-gated;
  ISO-8601 `due_on`; zero-time sentinel normalized to `null`).
- **Association:** numeric `milestone` on `create_issue`; `milestone` /
  `clear_milestone` tri-state on `edit_issue`; new `add_issue_labels` for
  existing issues. `create_issue.labels` stays numeric IDs (resolve via CEL from
  a `list_labels` snapshot — no in-method name resolution).
- **Projects:** NOT shipped. This instance reports Gitea-compat **1.27.3**, whose
  swagger exposes **no `/projects` API** (verified: zero matching paths). Manage
  boards in the UI. Revisit if the forge later exposes the projects surface.

---

## 1. CRUD methods

> HISTORICAL (v1 backlog, superseded). Most write paths below now ship — see the
> "Added in …" sections at the top of this file. Still outstanding: `merge_pull`,
> `fork_repo`, `delete_release`, reviewer-request, and label/milestone edit/delete.

### Issues & pull requests

| Method | API | Notes |
|--------|-----|-------|
| `create_issue` | `POST /repos/{owner}/{repo}/issues` | title, body, labels, assignees |
| `edit_issue` | `PATCH /repos/{owner}/{repo}/issues/{index}` | title, body, state, milestone |
| `create_issue_comment` | `POST /repos/{owner}/{repo}/issues/{index}/comments` | body |
| `create_pull` | `POST /repos/{owner}/{repo}/pulls` | head, base, title, body |
| `merge_pull` | `POST /repos/{owner}/{repo}/pulls/{index}/merge` | merge_message_field, Do (merge/squash/rebase) |

### Repos

| Method | API | Notes |
|--------|-----|-------|
| `create_repo` | `POST /user/repos` | name, description, private, auto_init |
| `create_org_repo` | `POST /orgs/{org}/repos` | same fields |
| `delete_repo` | `DELETE /repos/{owner}/{repo}` | destructive — add pre-flight check |
| `fork_repo` | `POST /repos/{owner}/{repo}/forks` | organization optional |

### Releases

| Method | API | Notes |
|--------|-----|-------|
| `create_release` | `POST /repos/{owner}/{repo}/releases` | tag_name, name, body, prerelease, draft |
| `delete_release` | `DELETE /repos/{owner}/{repo}/releases/{id}` | requires stored release id |

---

## 2. Gitea Actions / CI

The `GET /repos/{owner}/{repo}/actions/runs` endpoint lists workflow runs.
Useful for monitoring CI status from swamp workflows.

| Method | API |
|--------|-----|
| `list_runs` | `GET /repos/{owner}/{repo}/actions/runs` |
| `get_run` | `GET /repos/{owner}/{repo}/actions/runs/{run_id}` |
| `list_run_jobs` | `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs` |

Note: Gitea Actions endpoints require Gitea ≥ 1.21. Forgejo support may vary —
smoke test against your instance before publishing.

---

## 3. Webhooks

Useful for registering swamp workflows as Gitea webhook receivers.

| Method | API |
|--------|-----|
| `list_hooks` | `GET /repos/{owner}/{repo}/hooks` |
| `create_hook` | `POST /repos/{owner}/{repo}/hooks` |
| `delete_hook` | `DELETE /repos/{owner}/{repo}/hooks/{id}` |

---

## 4. Known limitations in v1

- **Pagination is manual.** All list methods expose `page` and `limit` args but
  do not auto-paginate. For repos with >50 issues, the caller must loop pages.
  Consider adding an `all` shorthand that collects all pages automatically.

- **PR diff stats absent from lists.** `additions`, `deletions`, and
  `changed_files` are `undefined` in `list_pulls` results (Gitea only populates
  them on individual `GET /pulls/{index}` calls). The schema marks these
  `.optional()`. Use `get_pull` when you need diff counts.

- **No rate limit handling.** If the API returns `429 Too Many Requests`, the
  method throws immediately. A future version should inspect the `Retry-After`
  header and retry with backoff.

- **`get_pull` untested against a live PR.** The smoke test instance had no open
  PRs at the time. The schema is correct per the swagger spec but should be
  validated against a real PR before relying on it in production workflows.

- **Instance names use `__` as separator.** CEL expressions reference per-repo
  data with the `owner__repo` pattern:
  ```
  data.latest("forgejo", "acme__infra").attributes.issues
  data.latest("forgejo", "testuser__demo").attributes
  ```

---

## 5. Testing gaps

- No unit tests written. Use `@swamp-club/swamp-testing` with
  `createModelTestContext` to mock the `fetch` calls. Priority targets:
  - `list_issues` — verify `type=issues` param is included (excludes PRs)
  - `PullRequestSchema` parse — verify optional diff stat fields don't error
  - `apiGet` error path — verify 4xx/5xx throws with status + body

- `list_pulls --state all` not smoke-tested.

- `list_releases` only tested against a repo with zero releases. Test against
  `testuser/lxc-templates` (has 4 releases) to exercise the release schema.

---

## 6. Nice-to-haves

- **`search_repos`** — `GET /repos/search?q=...&topic=true` for discovering
  public repos across the instance.

- **`list_org_repos`** — `GET /orgs/{org}/repos` scoped to an org, rather than
  the authenticated user's full list.

- **`get_user`** — `GET /users/{username}` for resolving contributor info.

- ~~**`list_labels`** — enumerate labels before creating issues.~~ ✅ shipped
  2026.09.28.1 (plus `create_label`, `list_milestones`, `create_milestone`,
  `add_issue_labels`).

- **Sensitive output for `create_release` assets** — if release asset upload is
  added, presigned URLs should use `z.meta({ sensitive: true })`.
