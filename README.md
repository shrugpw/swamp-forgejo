# @shrug/forgejo

Drive [Forgejo](https://forgejo.org/) and [Gitea](https://gitea.io/) instances
from [swamp](https://github.com/swamp-club/swamp) over their shared `/api/v1`
REST surface, authenticated with a **personal access token** — a swamp node for
a self-hosted git forge with read and (confirm-gated) write paths.

Forgejo and Gitea share the same REST API, so one model drives both. Every
method persists a typed, versioned snapshot that other models reference with CEL
expressions — no re-fetching. Every mutating method is **confirm-gated**
(`confirm=true` required) and every caller-supplied path segment is
percent-encoded.

## Methods

### Read

| Method | What it does |
| --- | --- |
| `list_repos` | Repositories accessible to the authenticated user. |
| `get_repo` | Details for one repository. |
| `list_issues` | Issues for a repo. Pins `type=issues` so **pull requests are excluded**; filter by `open`/`closed`/`all`. |
| `get_issue` | A single issue by number. |
| `list_pulls` | Pull requests for a repo, filterable by state. |
| `get_pull` | A single PR by number — populates `additions`/`deletions`/`changed_files`, which the list endpoint omits. |
| `list_releases` | Releases for a repo. |
| `list_deploy_keys` | Deploy keys registered on a repo — verify-first before creating one. |
| `list_orgs` | Organizations the authenticated user belongs to. |
| `list_org_repos` | Repositories owned by an org. |
| `list_org_teams` | Teams within an org. |
| `list_collaborators` | Collaborators on a repo — verify-first before adding. |
| `get_user` | A user account by login. |
| `list_labels` | Labels defined on a repo — verify-first before `create_label`. Excludes org-level labels. |
| `list_milestones` | Milestones on a repo (filter by state) — verify-first before `create_milestone`. |

### Write (confirm-gated)

| Method | What it does |
| --- | --- |
| `create_repo` / `create_org_repo` | Create a repo owned by the user / an org. |
| `edit_repo` | Patch a repo's settings (only provided fields sent). |
| `delete_repo` | Delete a repo — destructive; `get_repo` first to verify (Rule 5). |
| `create_deploy_key` | Register a deploy key. **Defaults to read-only** (least privilege); pass `read_only=false` to opt into write. |
| `add_collaborator` / `remove_collaborator` | Add (defaults to `write` permission) / remove a collaborator. |
| `add_org_team_member` | Add a user to an org team. |
| `create_issue` | Create an issue. `labels` are numeric **IDs** (resolve from a `list_labels` snapshot); `milestone` is a numeric ID. |
| `edit_issue` | Patch an issue. `milestone` sets / `clear_milestone` unsets (mutually exclusive); `assignees` (array) replaces, `[]` clears. |
| `create_issue_comment` | Comment on an issue. |
| `add_issue_labels` | Add labels (by ID) to an existing issue. |
| `create_pull` | Open a pull request (`head` → `base`, both required); optional `labels`/`milestone`/`assignees`. Verify-first with `list_pulls`. |
| `create_label` | Create a label (anchored-hex color). Bare create — verify-first with `list_labels`. |
| `create_milestone` | Create a milestone (ISO-8601 `due_on`). Bare create — verify-first with `list_milestones`. |
| `create_user` | Create a normal user account (requires a site-admin token). |

## Data model

Per-repo snapshots are keyed `owner__repo`; single issues and PRs append the
number as `owner__repo__<index>`:

```
data.latest("forgejo", "acme__infra").attributes.issues
data.latest("forgejo", "acme__infra").attributes.pulls
data.latest("forgejo", "acme__infra").attributes.labels      # list_labels
data.latest("forgejo", "acme__infra").attributes.milestones  # list_milestones
data.latest("forgejo", "testuser__demo__12").attributes.title
data.latest("forgejo", "main").attributes.repos               # list_repos
```

### Resolving label / milestone IDs

Forgejo's issue API expects label and milestone **IDs**, not names. Snapshot
them once and resolve IDs via CEL, then pass the IDs to `create_issue` /
`edit_issue` / `add_issue_labels`:

```bash
swamp model method run forgejo list_labels     --arg owner=acme --arg repo=infra
swamp model method run forgejo list_milestones --arg owner=acme --arg repo=infra
# then reference data.latest("forgejo","acme__infra").attributes.labels[…].id
```

Label names and milestone titles are **not unique** in Forgejo/Gitea, so resolve
deliberately (match all candidates, disambiguate) rather than assuming one hit.

## Security

- `token` is a **sensitive** global argument — wire it from a vault at
  model-create time, never inline it.
- The token is sent as an `Authorization: token …` header and is never logged.

## Quickstart

```bash
# 1. store the token in a vault
swamp vault put forgejo token           # hidden prompt

# 2. create the model, wiring the sensitive arg from the vault
swamp model create @shrug/forgejo forgejo \
  --global-arg host=https://git.example.org \
  --global-arg token='${{ vault.get(forgejo, token) }}'

# 3. use it
swamp model method run forgejo list_repos
swamp model method run forgejo list_issues --arg owner=acme --arg repo=infra --arg state=all
swamp model method run forgejo get_pull   --arg owner=acme --arg repo=infra --arg index=42
```

## Known limitations

- **Manual pagination.** List methods expose `page`/`limit` but do not
  auto-paginate; loop pages for repos with >50 items.
- **No rate-limit backoff.** A `429 Too Many Requests` throws immediately.
- **Diff stats only on `get_pull`.** `list_pulls` leaves `additions`,
  `deletions`, and `changed_files` `undefined` — the forge only populates them
  on the single-PR endpoint.
- **No Projects API.** Gitea 1.27.x (what this instance reports) exposes no
  `/projects` REST surface, so no project/board method ships. Manage project
  boards in the Forgejo UI.
- **Bare creates are not idempotent.** `create_deploy_key`, `create_label`, and
  `create_milestone` each POST unconditionally; the forge does not dedupe by
  name/title (only `create_deploy_key` rejects on exact public-key reuse). Call
  the matching `list_*` first and skip if the resource already exists —
  verify-first is the caller's responsibility, and a single `list_*` page may
  miss items past `limit`. There is no delete/edit surface for labels,
  milestones, or deploy keys yet — prune in the Forgejo UI.
- **No PR merge path.** `create_pull` opens PRs, but `merge_pull` and
  reviewer-request are not implemented yet.

## Development

```bash
# run the test suite (pure builders + schemas + fetch-mocked method wiring)
deno test forgejo_test.ts
```

Tests mock the global `fetch`, so no live forge is required.

## License

MIT © Neil Hanlon. See [LICENSE.txt](./LICENSE.txt).
