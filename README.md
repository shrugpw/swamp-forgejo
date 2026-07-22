# @shrug/forgejo

Query [Forgejo](https://forgejo.org/) and [Gitea](https://gitea.io/) instances
from [swamp](https://github.com/swamp-club/swamp) over their shared `/api/v1`
REST surface, authenticated with a **personal access token**. A read-only swamp
node for a self-hosted git forge.

Forgejo and Gitea share the same REST API, so one model drives both. Every
method persists a typed, versioned snapshot that other models reference with CEL
expressions — no re-fetching.

## Methods

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
| `create_deploy_key` | Register a deploy key on a repo. **Defaults to read-only** (least privilege); pass `read_only=false` to opt into write. |

## Data model

Per-repo snapshots are keyed `owner__repo`; single issues and PRs append the
number as `owner__repo__<index>`:

```
data.latest("forgejo", "shrug__infra").attributes.issues
data.latest("forgejo", "shrug__infra").attributes.pulls
data.latest("forgejo", "neil__aoc2024__12").attributes.title
data.latest("forgejo", "main").attributes.repos          # list_repos
```

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
  --global-arg host=https://git.shrug.pw \
  --global-arg token='${{ vault.get(forgejo, token) }}'

# 3. use it
swamp model method run forgejo list_repos
swamp model method run forgejo list_issues --arg owner=shrug --arg repo=infra --arg state=all
swamp model method run forgejo get_pull   --arg owner=shrug --arg repo=infra --arg index=42
```

## Known limitations

- **Manual pagination.** List methods expose `page`/`limit` but do not
  auto-paginate; loop pages for repos with >50 items.
- **No rate-limit backoff.** A `429 Too Many Requests` throws immediately.
- **Diff stats only on `get_pull`.** `list_pulls` leaves `additions`,
  `deletions`, and `changed_files` `undefined` — the forge only populates them
  on the single-PR endpoint.
- **Mostly read-only.** The only write path is deploy-key registration
  (`create_deploy_key`); there is no edit/merge/delete surface yet.
- **`create_deploy_key` is not idempotent.** Each call POSTs a new key; the
  forge only rejects on exact public-key reuse. Call `list_deploy_keys` first
  and skip if the key already exists. There is no `delete_deploy_key` — prune
  stale keys in the Forgejo UI.

## Development

```bash
# run the test suite (pure builders + schemas + fetch-mocked method wiring)
deno test forgejo_test.ts
```

Tests mock the global `fetch`, so no live forge is required.

## License

MIT © Neil Hanlon. See [LICENSE.txt](./LICENSE.txt).
