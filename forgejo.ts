import { z } from "npm:zod@4";

// ── Shared sub-schemas ────────────────────────────────────────────────────────

/** A Forgejo/Gitea user or org account as embedded in issues, PRs, repos, and releases. */
export const UserSchema = z.object({
  id: z.number(),
  login: z.string(),
  full_name: z.string(),
  email: z.string(),
  html_url: z.string(),
  avatar_url: z.string(),
});

/** An issue/PR label, as embedded in issues and pull requests. */
export const LabelSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  description: z.string(),
});

/**
 * A repository label as returned by the `/labels` collection and the
 * issue-labels endpoints. A superset of the embedded `LabelSchema` — it also
 * carries `url` and the `exclusive`/`is_archived` flags. Kept as a SEPARATE
 * schema so the embedded `LabelSchema` used by `IssueSchema`/`PullRequestSchema`
 * is never mutated (those responses omit `url`/`exclusive`/`is_archived`).
 * `exclusive`/`is_archived` are optional to tolerate older Gitea/Forgejo builds.
 */
export const RepoLabelSchema = LabelSchema.extend({
  exclusive: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  // Optional: a forge/version that returns a lean label response (no `url`) must
  // not throw a post-mutation parse error after create_label/add_issue_labels.
  url: z.string().optional(),
});

/**
 * A repository milestone. `due_on`/`closed_at` are nullish: Gitea/Forgejo emits
 * the zero-time sentinel `0001-01-01T00:00:00Z` (or omits the field) when unset,
 * which the methods normalize to `null` via `normalizeMilestone` before writing a
 * snapshot so a CEL caller can't mistake the sentinel for a real date.
 */
export const MilestoneSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string(),
  state: z.enum(["open", "closed"]),
  open_issues: z.number(),
  closed_issues: z.number(),
  // Gitea serializes Created/Updated as *time.Time with no omitempty — they can
  // be null. Kept nullish so an embedded milestone with a null timestamp does not
  // throw on the issue read path (list_issues/get_issue now surface milestone).
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  due_on: z.string().nullish(),
  closed_at: z.string().nullish(),
});

/** Map the Gitea zero-time sentinel (`0001-01-01…`), `undefined`, or `null` to `null`; pass real datetimes through. */
export function nullIfZeroTime(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  return v.startsWith("0001-01-01") ? null : v;
}

/** Normalize a parsed milestone's `due_on`/`closed_at` sentinels to `null`. */
export function normalizeMilestone(
  m: z.infer<typeof MilestoneSchema>,
): z.infer<typeof MilestoneSchema> {
  return {
    ...m,
    due_on: nullIfZeroTime(m.due_on),
    closed_at: nullIfZeroTime(m.closed_at),
  };
}

/** Normalize a parsed issue's embedded milestone dates (no-op when unset). */
export function normalizeIssue(
  issue: z.infer<typeof IssueSchema>,
): z.infer<typeof IssueSchema> {
  return issue.milestone
    ? { ...issue, milestone: normalizeMilestone(issue.milestone) }
    : issue;
}

/** Normalize a parsed pull request's embedded milestone dates (no-op when unset). */
export function normalizePull(
  pull: z.infer<typeof PullRequestSchema>,
): z.infer<typeof PullRequestSchema> {
  return pull.milestone
    ? { ...pull, milestone: normalizeMilestone(pull.milestone) }
    : pull;
}

/** Minimal repository reference embedded in an issue's `repository` field. */
export const RepoMetaSchema = z.object({
  id: z.number(),
  name: z.string(),
  owner: z.string(),
  full_name: z.string(),
});

// ── Resource schemas ──────────────────────────────────────────────────────────

/** A repository, as returned by `/user/repos` and `/repos/{owner}/{repo}`. */
export const RepoSchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  description: z.string(),
  private: z.boolean(),
  fork: z.boolean(),
  template: z.boolean(),
  mirror: z.boolean(),
  archived: z.boolean(),
  empty: z.boolean(),
  html_url: z.string(),
  ssh_url: z.string(),
  clone_url: z.string(),
  language: z.string().nullable(),
  default_branch: z.string(),
  stars_count: z.number(),
  forks_count: z.number(),
  watchers_count: z.number(),
  open_issues_count: z.number(),
  open_pr_counter: z.number(),
  release_counter: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  owner: UserSchema,
});

/** An issue. `list_issues` pins `type=issues` so pull requests never appear here. */
export const IssueSchema = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  state: z.string(),
  body: z.string().nullable(),
  html_url: z.string(),
  url: z.string(),
  user: UserSchema,
  labels: z.array(LabelSchema),
  // The issue's associated milestone (null when unset). Surfaced so a driver can
  // confirm create_issue/edit_issue milestone association from the snapshot — the
  // forge attaches it server-side, but it was previously stripped here.
  milestone: MilestoneSchema.nullable().optional(),
  // Assignees (array; null/empty when none). Surfaced so create_issue/edit_issue
  // assignee association is visible in the snapshot.
  assignees: z.array(UserSchema).nullable().optional(),
  comments: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable(),
  repository: RepoMetaSchema.optional(),
});

// Simplified branch info — avoids embedding the full repo object recursively
/** The head/base branch of a pull request (flattened to avoid recursive repo embedding). */
export const PRBranchSchema = z.object({
  label: z.string(),
  ref: z.string(),
  sha: z.string(),
  repo_id: z.number().optional(),
});

/** A pull request. Diff stats (`additions`/`deletions`/`changed_files`) are only populated by `get_pull`. */
export const PullRequestSchema = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  state: z.string(),
  body: z.string().nullable(),
  html_url: z.string(),
  url: z.string(),
  diff_url: z.string(),
  patch_url: z.string(),
  user: UserSchema,
  labels: z.array(LabelSchema),
  // Milestone/assignees are surfaced so create_pull association is visible in the
  // snapshot (parity with IssueSchema). Absent from list/get responses when unset,
  // so nullable+optional keeps get_pull/list_pulls parsing unchanged.
  milestone: MilestoneSchema.nullable().optional(),
  assignees: z.array(UserSchema).nullable().optional(),
  draft: z.boolean(),
  merged: z.boolean(),
  // State-dependent fields: on a freshly created PR the forge may leave these
  // uncomputed (null) or omit them entirely across versions — kept nullish so a
  // create-response parse can't throw AFTER the PR is created (post-mutation
  // parse-throw defense, mirroring RepoLabelSchema.url).
  mergeable: z.boolean().nullish(),
  comments: z.number(),
  review_comments: z.number(),
  // Absent from list responses; only populated by get_pull
  additions: z.number().optional(),
  deletions: z.number().optional(),
  changed_files: z.number().optional(),
  head: PRBranchSchema,
  base: PRBranchSchema,
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullish(),
  merged_at: z.string().nullish(),
  merge_commit_sha: z.string().nullish(),
});

/** A release for a repository. */
export const ReleaseSchema = z.object({
  id: z.number(),
  tag_name: z.string(),
  name: z.string().nullable(),
  body: z.string().nullable(),
  prerelease: z.boolean(),
  draft: z.boolean(),
  html_url: z.string(),
  tarball_url: z.string(),
  zipball_url: z.string(),
  created_at: z.string(),
  published_at: z.string(),
  target_commitish: z.string(),
  author: UserSchema,
});

/** A repository deploy key, as returned by `/repos/{owner}/{repo}/keys`. */
export const DeployKeySchema = z.object({
  id: z.number(),
  key: z.string(),
  url: z.string(),
  title: z.string(),
  fingerprint: z.string(),
  created_at: z.string(),
  read_only: z.boolean(),
});

/**
 * An organization account. Gitea/Forgejo expose the login as `username` (with a
 * deprecated `name` alias); both are kept optional so either shape parses.
 */
export const OrgSchema = z.object({
  id: z.number(),
  username: z.string().optional(),
  name: z.string().optional(),
  full_name: z.string(),
  description: z.string(),
  visibility: z.string(),
  avatar_url: z.string(),
}).refine((o) => o.username !== undefined || o.name !== undefined, {
  message: "org must carry at least one of `username` or `name`",
});

/** A team within an organization. `permission` may be read/write/admin/owner/none. */
export const TeamSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  permission: z.string(),
  units: z.array(z.string()).optional(),
});

/** A comment on an issue or pull request. */
export const CommentSchema = z.object({
  id: z.number(),
  html_url: z.string(),
  body: z.string(),
  user: UserSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

/** Collaborator permission level. `add_collaborator` defaults to `write` (least privilege). */
export const CollaboratorPermission = z.enum(["read", "write", "admin"]);

/** Synthesized collaborator membership record (the PUT endpoint returns no body). */
export const CollaboratorMembershipSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  username: z.string(),
  permission: CollaboratorPermission,
});

/** Synthesized team-membership record (the PUT endpoint returns no body). */
export const TeamMembershipSchema = z.object({
  team_id: z.number(),
  username: z.string(),
});

// ── Global arguments ──────────────────────────────────────────────────────────

/** Model global arguments: the forge `host` URL and a sensitive access `token`. */
export const GlobalArgsSchema = z.object({
  host: z.string().url().describe(
    "Forgejo or Gitea instance URL (e.g. https://codeberg.org). No trailing slash.",
  ),
  token: z.string().meta({ sensitive: true }).describe(
    "Personal access token for the Forgejo/Gitea instance.",
  ),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// ── URL / path construction (pure) ────────────────────────────────────────────
//
// Every builder returns the path *after* `/api/v1`. Keeping these pure and
// exported lets the test suite assert the exact query strings — in particular
// that `list_issues` pins `type=issues` (Gitea's /issues endpoint returns PRs
// too unless this filter is present).

/** Path for `list_repos` (authenticated user's repositories). */
export function userReposPath(page: number, limit: number): string {
  return `/user/repos?page=${page}&limit=${limit}`;
}

/** Path for `get_repo`. */
export function repoPath(owner: string, repo: string): string {
  return `/repos/${owner}/${repo}`;
}

/** Path for `list_issues`. Pins `type=issues` so pull requests are excluded. */
export function issuesPath(
  owner: string,
  repo: string,
  state: string,
  page: number,
  limit: number,
): string {
  return `/repos/${owner}/${repo}/issues?type=issues&state=${state}&page=${page}&limit=${limit}`;
}

/** Path for `get_issue` (single issue by number). */
export function issuePath(owner: string, repo: string, index: number): string {
  return `/repos/${owner}/${repo}/issues/${index}`;
}

/** Path for `list_pulls`. */
export function pullsPath(
  owner: string,
  repo: string,
  state: string,
  page: number,
  limit: number,
): string {
  return `/repos/${owner}/${repo}/pulls?state=${state}&page=${page}&limit=${limit}`;
}

/** Path for `get_pull` (single PR by number). */
export function pullPath(owner: string, repo: string, index: number): string {
  return `/repos/${owner}/${repo}/pulls/${index}`;
}

/** Path for `list_releases`. */
export function releasesPath(
  owner: string,
  repo: string,
  page: number,
  limit: number,
): string {
  return `/repos/${owner}/${repo}/releases?page=${page}&limit=${limit}`;
}

/**
 * Path for `list_deploy_keys` / `create_deploy_key` (repo deploy-keys
 * collection). Unlike the read-only path builders, `owner`/`repo` are
 * percent-encoded here: this is the first *write* endpoint (it mints a
 * persistent SSH access credential), so a crafted segment containing `/`,
 * `..`, `?`, or `#` must not be able to misdirect key creation to another
 * repo the PAT can reach. (SEC-1.)
 */
export function deployKeysPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/keys`;
}

// ── Write / discovery path builders (SEC-1: encode every segment) ──────────────
//
// Like `deployKeysPath`, every builder below percent-encodes each caller-supplied
// segment (owner, repo, org, username, index, id). These back live mutations, so
// a crafted segment containing `/`, `..`, `?`, or `#` must not be able to escape
// its path position and misdirect the write to another resource the PAT reaches.

/** Path for `create_org_repo` (org-owned repository collection). */
export function orgReposPath(org: string): string {
  return `/orgs/${encodeURIComponent(org)}/repos`;
}

/** Path for `list_orgs` (organizations the authenticated user belongs to). */
export function orgsPath(): string {
  return `/user/orgs`;
}

/** Path for `list_org_teams` (an organization's teams). */
export function orgTeamsPath(org: string): string {
  return `/orgs/${encodeURIComponent(org)}/teams`;
}

/** Path for `add_org_team_member` (a team's membership entry for a user). */
export function teamMemberPath(teamId: number, username: string): string {
  return `/teams/${encodeURIComponent(String(teamId))}/members/${
    encodeURIComponent(username)
  }`;
}

/** Path for `edit_repo` / `delete_repo` (single repository, mutating). */
export function repoBasePath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/** Path for `list_collaborators` (a repository's collaborator collection). */
export function collaboratorsPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${
    encodeURIComponent(repo)
  }/collaborators`;
}

/** Path for `add_collaborator` / `remove_collaborator` (single collaborator). */
export function collaboratorPath(
  owner: string,
  repo: string,
  username: string,
): string {
  return `/repos/${encodeURIComponent(owner)}/${
    encodeURIComponent(repo)
  }/collaborators/${encodeURIComponent(username)}`;
}

/** Path for `get_user` (a single user account by login). */
export function userPath(username: string): string {
  return `/users/${encodeURIComponent(username)}`;
}

/** Path for `create_issue` (a repository's issue collection). */
export function issuesCreatePath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${
    encodeURIComponent(repo)
  }/issues`;
}

/**
 * Path for `create_pull` (a repository's pull-request collection). SEC-1: encode
 * every caller segment. Separate from the read-only `pullsPath` (which appends
 * query params and is not encoded) because this backs a live mutation.
 */
export function pullsCreatePath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${
    encodeURIComponent(repo)
  }/pulls`;
}

/** Path for `edit_issue` (a single issue, mutating). */
export function issueEditPath(
  owner: string,
  repo: string,
  index: number,
): string {
  return `/repos/${encodeURIComponent(owner)}/${
    encodeURIComponent(repo)
  }/issues/${encodeURIComponent(String(index))}`;
}

/** Path for `create_issue_comment` (an issue's comment collection). */
export function issueCommentsPath(
  owner: string,
  repo: string,
  index: number,
): string {
  return `/repos/${encodeURIComponent(owner)}/${
    encodeURIComponent(repo)
  }/issues/${encodeURIComponent(String(index))}/comments`;
}

/**
 * Path for `create_user` (the site-admin user-provisioning collection). Takes no
 * caller-supplied segments, so there is nothing to encode: the username/email are
 * carried in the POST body, not the URL.
 */
export function adminUsersPath(): string {
  return `/admin/users`;
}

/** Path for `list_labels` / `create_label` (a repository's label collection). SEC-1: encode every segment. */
export function labelsPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${
    encodeURIComponent(repo)
  }/labels`;
}

/** Path for `list_milestones` / `create_milestone` (a repository's milestone collection). SEC-1: encode every segment. */
export function milestonesPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${
    encodeURIComponent(repo)
  }/milestones`;
}

/** Path for `add_issue_labels` (an issue's label collection). SEC-1: encode every segment, including the index. */
export function issueLabelsPath(
  owner: string,
  repo: string,
  index: number,
): string {
  return `/repos/${encodeURIComponent(owner)}/${
    encodeURIComponent(repo)
  }/issues/${encodeURIComponent(String(index))}/labels`;
}

// Instance names key per-repo (or per-repo-per-number) data snapshots. The `__`
// separator is what CEL callers reference:
//   data.latest("forgejo", "owner__repo").attributes.issues
/** Build the `owner__repo`(`__index`) instance name CEL callers reference. */
export function instanceName(
  owner: string,
  repo: string,
  index?: number,
): string {
  return index === undefined
    ? `${owner}__${repo}`
    : `${owner}__${repo}__${index}`;
}

/**
 * Join arbitrary instance-name segments with the same `__` separator
 * `instanceName` uses, for keys with more parts than owner/repo/index
 * (e.g. `collaborator@owner__repo__username`, `issue_comment@owner__repo__index__id`).
 *
 * Each segment is collision-safe: it is percent-encoded *and* its underscores are
 * escaped to `%5F` before joining. Without escaping underscores, a segment
 * containing `__` would blur the segment boundary, so e.g. `('a','b__c','d')`
 * and `('a__b','c','d')` would collide on the same key and corrupt each other's
 * snapshots. (CORR-1.)
 */
export function instanceKey(...parts: (string | number)[]): string {
  return parts
    .map((p) => encodeURIComponent(String(p)).replaceAll("_", "%5F"))
    .join("__");
}

// ── API helper ────────────────────────────────────────────────────────────────

/** Authenticated GET against `{host}/api/v1{path}`. Throws with status + body on any non-2xx. */
export async function apiGet(
  host: string,
  token: string,
  path: string,
): Promise<unknown> {
  const url = `${host.replace(/\/$/, "")}/api/v1${path}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Forgejo/Gitea API error ${resp.status} on GET ${path}: ${body}`,
    );
  }
  return resp.json();
}

/** Authenticated POST against `{host}/api/v1{path}` with a JSON body. Throws with status + body on any non-2xx. */
export async function apiPost(
  host: string,
  token: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  const url = `${host.replace(/\/$/, "")}/api/v1${path}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Forgejo/Gitea API error ${resp.status} on POST ${path}: ${body}`,
    );
  }
  return resp.json();
}

/** Authenticated PATCH against `{host}/api/v1{path}` with a JSON body. Throws with status + body on any non-2xx. */
export async function apiPatch(
  host: string,
  token: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  const url = `${host.replace(/\/$/, "")}/api/v1${path}`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(
      `Forgejo/Gitea API error ${resp.status} on PATCH ${path}: ${errBody}`,
    );
  }
  return resp.json();
}

/**
 * Authenticated PUT against `{host}/api/v1{path}`. `body` is optional (many
 * membership PUTs take none). Returns the parsed JSON, or `null` when the
 * response has an empty body (e.g. `204 No Content`) — `.json()` is never called
 * on an empty body, which would throw.
 */
export async function apiPut(
  host: string,
  token: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${host.replace(/\/$/, "")}/api/v1${path}`;
  const headers: Record<string, string> = {
    Authorization: `token ${token}`,
    Accept: "application/json",
  };
  const init: RequestInit = { method: "PUT", headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(
      `Forgejo/Gitea API error ${resp.status} on PUT ${path}: ${errBody}`,
    );
  }
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Authenticated DELETE against `{host}/api/v1{path}`. Returns `null` on an empty
 * body (`204 No Content`, the usual Gitea/Forgejo delete response), else the
 * parsed JSON. Never calls `.json()` on an empty body.
 */
export async function apiDelete(
  host: string,
  token: string,
  path: string,
): Promise<unknown> {
  const url = `${host.replace(/\/$/, "")}/api/v1${path}`;
  const resp = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(
      `Forgejo/Gitea API error ${resp.status} on DELETE ${path}: ${errBody}`,
    );
  }
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

// ── Method context (framework-supplied at runtime) ────────────────────────────

type Logger = {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  error?: (msg: string, meta?: Record<string, unknown>) => void;
  debug?: (msg: string, meta?: Record<string, unknown>) => void;
};

type WriteResource = (
  resource: string,
  instance: string,
  value: unknown,
) => Promise<unknown>;

type Context = {
  globalArgs: z.infer<typeof GlobalArgsSchema>;
  writeResource: WriteResource;
  logger: Logger;
};

// ── Method argument schemas ───────────────────────────────────────────────────

const PageArgs = {
  page: z.number().int().positive().default(1).describe(
    "Page number (1-based).",
  ),
  limit: z.number().int().positive().max(50).default(50).describe(
    "Results per page (max 50).",
  ),
};

const ListReposArgs = z.object({ ...PageArgs });

const RepoRefArgs = {
  owner: z.string().describe("Repository owner."),
  repo: z.string().describe("Repository name."),
};

const GetRepoArgs = z.object({
  owner: z.string().describe("Repository owner (user or org login)."),
  repo: z.string().describe("Repository name."),
});

/** Arguments for `list_issues`: repo ref, `state` filter (default open), pagination. */
export const ListIssuesArgs = z.object({
  ...RepoRefArgs,
  state: z.enum(["open", "closed", "all"]).default("open").describe(
    "Filter by issue state.",
  ),
  ...PageArgs,
});

const GetIssueArgs = z.object({
  ...RepoRefArgs,
  index: z.number().int().positive().describe("Issue number."),
});

const ListPullsArgs = z.object({
  ...RepoRefArgs,
  state: z.enum(["open", "closed", "all"]).default("open").describe(
    "Filter by pull request state.",
  ),
  ...PageArgs,
});

const GetPullArgs = z.object({
  ...RepoRefArgs,
  index: z.number().int().positive().describe("Pull request number."),
});

const ListReleasesArgs = z.object({ ...RepoRefArgs, ...PageArgs });

const ListDeployKeysArgs = z.object({ ...RepoRefArgs });

export const CreateDeployKeyArgs = z.object({
  ...RepoRefArgs,
  title: z.string().min(1).describe("Human-readable label for the deploy key."),
  key: z.string().min(1).describe(
    "Public key material, e.g. 'ssh-ed25519 AAAA...'.",
  ),
  read_only: z.boolean().default(true).describe(
    "Grant read-only access (true, default) or read/write (false).",
  ),
});

export const CreateRepoArgs = z.object({
  name: z.string().min(1).describe("Repository name."),
  description: z.string().default("").describe("Repository description."),
  private: z.boolean().default(false).describe(
    "Whether the repository is private (default false — public, anonymously cloneable).",
  ),
  auto_init: z.boolean().default(false).describe(
    "Initialize with an initial commit (README). Leave false to push an existing history.",
  ),
  default_branch: z.string().default("main").describe("Default branch name."),
  confirm: z.boolean().default(false).describe(
    "Must be true to create the repository — this is a live mutation.",
  ),
});

export const CreateOrgRepoArgs = z.object({
  org: z.string().min(1).describe(
    "Organization login that will own the repository.",
  ),
  name: z.string().min(1).describe("Repository name."),
  description: z.string().default("").describe("Repository description."),
  private: z.boolean().default(false).describe(
    "Whether the repository is private (default false).",
  ),
  auto_init: z.boolean().default(false).describe(
    "Initialize with an initial commit (README). Leave false to push an existing history.",
  ),
  default_branch: z.string().default("main").describe("Default branch name."),
  confirm: z.boolean().default(false).describe(
    "Must be true to create the repository — this is a live mutation.",
  ),
});

export const EditRepoArgs = z.object({
  ...RepoRefArgs,
  private: z.boolean().optional().describe(
    "Set the repository private (true) or public (false). Omit to leave unchanged.",
  ),
  description: z.string().optional().describe(
    "New description. Omit to leave unchanged.",
  ),
  default_branch: z.string().optional().describe(
    "New default branch. Omit to leave unchanged.",
  ),
  archived: z.boolean().optional().describe(
    "Archive (true) or unarchive (false) the repository. Omit to leave unchanged.",
  ),
  confirm: z.boolean().default(false).describe(
    "Must be true to edit the repository — this is a live mutation.",
  ),
});

export const DeleteRepoArgs = z.object({
  ...RepoRefArgs,
  confirm: z.boolean().default(false).describe(
    "Must be true to delete the repository — this is a destructive live mutation.",
  ),
});

const ListOrgsArgs = z.object({ ...PageArgs });

const ListOrgReposArgs = z.object({
  org: z.string().min(1).describe("Organization login."),
  ...PageArgs,
});

const GetUserArgs = z.object({
  username: z.string().min(1).describe("User login."),
});

const ListCollaboratorsArgs = z.object({ ...RepoRefArgs });

export const AddCollaboratorArgs = z.object({
  ...RepoRefArgs,
  username: z.string().min(1).describe("User to add as a collaborator."),
  permission: CollaboratorPermission.default("write").describe(
    "Permission level (read/write/admin). Defaults to write (least privilege).",
  ),
  confirm: z.boolean().default(false).describe(
    "Must be true to add the collaborator — this is a live mutation.",
  ),
});

export const RemoveCollaboratorArgs = z.object({
  ...RepoRefArgs,
  username: z.string().min(1).describe("Collaborator to remove."),
  confirm: z.boolean().default(false).describe(
    "Must be true to remove the collaborator — this is a live mutation.",
  ),
});

const ListOrgTeamsArgs = z.object({
  org: z.string().min(1).describe("Organization login."),
});

export const AddOrgTeamMemberArgs = z.object({
  team_id: z.number().int().positive().describe("Team ID."),
  username: z.string().min(1).describe("User to add to the team."),
  confirm: z.boolean().default(false).describe(
    "Must be true to add the team member — this is a live mutation.",
  ),
});

export const CreateIssueArgs = z.object({
  ...RepoRefArgs,
  title: z.string().min(1).describe("Issue title."),
  body: z.string().default("").describe("Issue body (markdown)."),
  labels: z.array(z.number().int().positive()).optional().describe(
    "Label IDs to apply (Forgejo's issue API expects IDs, not names — resolve names to IDs from a list_labels snapshot). Omit to apply none.",
  ),
  milestone: z.number().int().positive().optional().describe(
    "Milestone ID to associate (resolve from a list_milestones snapshot). Omit for none.",
  ),
  assignees: z.array(z.string()).optional().describe(
    "Usernames to assign. Omit to assign none.",
  ),
  confirm: z.boolean().default(false).describe(
    "Must be true to create the issue — this is a live mutation.",
  ),
});

export const EditIssueArgs = z.object({
  ...RepoRefArgs,
  index: z.number().int().positive().describe("Issue number."),
  title: z.string().optional().describe(
    "New title. Omit to leave unchanged.",
  ),
  body: z.string().optional().describe("New body. Omit to leave unchanged."),
  state: z.enum(["open", "closed"]).optional().describe(
    "New state (open/closed). Omit to leave unchanged.",
  ),
  milestone: z.number().int().positive().optional().describe(
    "Set the milestone to this ID. Omit to leave unchanged (use clear_milestone to unset).",
  ),
  clear_milestone: z.boolean().optional().describe(
    "Unset the issue's milestone (sends milestone=0). Mutually exclusive with milestone.",
  ),
  assignees: z.array(z.string()).optional().describe(
    "Replace the issue's assignees with these usernames. Omit to leave unchanged; pass [] to clear all assignees.",
  ),
  confirm: z.boolean().default(false).describe(
    "Must be true to edit the issue — this is a live mutation.",
  ),
}).refine((a) => !(a.clear_milestone && a.milestone !== undefined), {
  message: "Provide either milestone or clear_milestone, not both.",
  path: ["clear_milestone"],
});

export const CreateIssueCommentArgs = z.object({
  ...RepoRefArgs,
  index: z.number().int().positive().describe("Issue number to comment on."),
  body: z.string().min(1).describe("Comment body (markdown)."),
  confirm: z.boolean().default(false).describe(
    "Must be true to create the comment — this is a live mutation.",
  ),
});

export const CreateUserArgs = z.object({
  username: z.string().min(1).describe("Login for the new account."),
  email: z.string().describe("Email address for the new account."),
  password: z.string().meta({ sensitive: true }).describe(
    "Initial password for the new account. Sensitive — never logged.",
  ),
  must_change_password: z.boolean().default(true).describe(
    "Force a password change on first sign-in (default true).",
  ),
  restricted: z.boolean().default(false).describe(
    "Create the account as restricted (default false).",
  ),
  visibility: z.enum(["public", "limited", "private"]).default("private")
    .describe(
      "Account visibility (default private — least privilege).",
    ),
  confirm: z.boolean().default(false).describe(
    "Must be true to create the user — this is a live mutation.",
  ),
});

const ListLabelsArgs = z.object({ ...RepoRefArgs, ...PageArgs });

/** 6-digit hex color, leading `#` optional (normalized to include it before the POST). */
const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/;

export const CreateLabelArgs = z.object({
  ...RepoRefArgs,
  name: z.string().min(1).describe("Label name."),
  color: z.string().regex(
    HEX_COLOR,
    "color must be a 6-digit hex like #00aabb (leading # optional)",
  ).describe("Label color as a 6-digit hex (leading # optional; normalized)."),
  description: z.string().default("").describe("Label description."),
  exclusive: z.boolean().default(false).describe(
    "Whether the label is exclusive within its scoped group (default false).",
  ),
  is_archived: z.boolean().default(false).describe(
    "Whether the label is archived (default false).",
  ),
  confirm: z.boolean().default(false).describe(
    "Must be true to create the label — this is a live mutation.",
  ),
});

const ListMilestonesArgs = z.object({
  ...RepoRefArgs,
  state: z.enum(["open", "closed", "all"]).default("open").describe(
    "Filter by milestone state.",
  ),
  ...PageArgs,
});

export const CreateMilestoneArgs = z.object({
  ...RepoRefArgs,
  title: z.string().min(1).describe("Milestone title."),
  description: z.string().default("").describe("Milestone description."),
  due_on: z.string().datetime().optional().describe(
    "Due date as an ISO-8601 datetime (e.g. 2026-12-31T00:00:00Z). Omit for no deadline.",
  ),
  state: z.enum(["open", "closed"]).default("open").describe(
    "Initial milestone state (default open).",
  ),
  confirm: z.boolean().default(false).describe(
    "Must be true to create the milestone — this is a live mutation.",
  ),
});

export const AddIssueLabelsArgs = z.object({
  ...RepoRefArgs,
  index: z.number().int().positive().describe("Issue number to add labels to."),
  labels: z.array(z.number().int().positive()).min(1).describe(
    "Label IDs to add (resolve from a list_labels snapshot). Appended to the issue's existing labels.",
  ),
  confirm: z.boolean().default(false).describe(
    "Must be true to add the labels — this is a live mutation.",
  ),
});

export const CreatePullArgs = z.object({
  ...RepoRefArgs,
  head: z.string().min(1).describe(
    "Source branch, or '<user>:<branch>' for a fork's branch.",
  ),
  base: z.string().min(1).describe(
    "Target branch to merge into. Required — read the repo's default branch from a get_repo/list_repos snapshot if you want it.",
  ),
  title: z.string().min(1).describe("Pull request title."),
  body: z.string().default("").describe("Pull request body (markdown)."),
  labels: z.array(z.number().int().positive()).optional().describe(
    "Label IDs to apply (resolve from a list_labels snapshot). Omit to apply none.",
  ),
  milestone: z.number().int().positive().optional().describe(
    "Milestone ID to associate (resolve from a list_milestones snapshot). Omit for none.",
  ),
  assignees: z.array(z.string()).optional().describe(
    "Usernames to assign. Omit to assign none.",
  ),
  confirm: z.boolean().default(false).describe(
    "Must be true to create the pull request — this is a live mutation.",
  ),
});

// ── Model ─────────────────────────────────────────────────────────────────────

/** The `@shrug/forgejo` model: read + confirm-gated write access over the Forgejo/Gitea `/api/v1` REST surface. */
export const model = {
  type: "@shrug/forgejo",
  version: "2026.09.29.2",
  globalArguments: GlobalArgsSchema,

  // globalArguments (host, token, metadata) are unchanged from the published
  // 2026.07.17.1; every change since is purely additive (new label/milestone/
  // issue-association methods + resources + optional method inputs, and surfacing
  // the milestone/assignees fields on IssueSchema), so existing instances need no
  // data transform — a no-op migration just advances their typeVersion.
  upgrades: [
    {
      toVersion: "2026.09.29.2",
      description:
        "Additive write methods (labels, milestones, issue label/milestone/assignee association, create_pull) and surfaced issue/PR milestone/assignees fields; no globalArguments schema change.",
      upgradeAttributes: (old: Record<string, unknown>) => old,
    },
  ],

  resources: {
    repos: {
      description: "Repositories accessible to the authenticated user",
      schema: z.object({
        repos: z.array(RepoSchema),
        count: z.number(),
        page: z.number(),
        limit: z.number(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    repo: {
      description: "Details for a single repository",
      schema: RepoSchema,
      lifetime: "1h",
      garbageCollection: 5,
    },
    issues: {
      description: "Issues for a repository",
      schema: z.object({
        issues: z.array(IssueSchema),
        count: z.number(),
        owner: z.string(),
        repo: z.string(),
        state: z.string(),
        page: z.number(),
        limit: z.number(),
      }),
      lifetime: "30m",
      garbageCollection: 5,
    },
    issue: {
      description: "A single issue",
      schema: IssueSchema,
      lifetime: "30m",
      garbageCollection: 5,
    },
    pulls: {
      description: "Pull requests for a repository",
      schema: z.object({
        pulls: z.array(PullRequestSchema),
        count: z.number(),
        owner: z.string(),
        repo: z.string(),
        state: z.string(),
        page: z.number(),
        limit: z.number(),
      }),
      lifetime: "30m",
      garbageCollection: 5,
    },
    pull: {
      description: "A single pull request",
      schema: PullRequestSchema,
      lifetime: "30m",
      garbageCollection: 5,
    },
    releases: {
      description: "Releases for a repository",
      schema: z.object({
        releases: z.array(ReleaseSchema),
        count: z.number(),
        owner: z.string(),
        repo: z.string(),
        page: z.number(),
        limit: z.number(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    deploy_keys: {
      description: "Deploy keys registered on a repository",
      schema: z.object({
        keys: z.array(DeployKeySchema),
        count: z.number(),
        owner: z.string(),
        repo: z.string(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    deploy_key: {
      description: "A single deploy key created on a repository",
      schema: DeployKeySchema,
      lifetime: "1h",
      garbageCollection: 5,
    },
    orgs: {
      description: "Organizations the authenticated user belongs to",
      schema: z.object({
        orgs: z.array(OrgSchema),
        count: z.number(),
        page: z.number(),
        limit: z.number(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    org_repos: {
      description: "Repositories owned by an organization",
      schema: z.object({
        repos: z.array(RepoSchema),
        count: z.number(),
        org: z.string(),
        page: z.number(),
        limit: z.number(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    org_teams: {
      description: "Teams within an organization",
      schema: z.object({
        teams: z.array(TeamSchema),
        count: z.number(),
        org: z.string(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    collaborators: {
      description: "Collaborators on a repository",
      schema: z.object({
        collaborators: z.array(UserSchema),
        count: z.number(),
        owner: z.string(),
        repo: z.string(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    user: {
      description: "A single user account",
      schema: UserSchema,
      lifetime: "1h",
      garbageCollection: 5,
    },
    collaborator: {
      description:
        "A synthesized collaborator membership record (the add endpoint returns no body)",
      schema: CollaboratorMembershipSchema,
      lifetime: "1h",
      garbageCollection: 5,
    },
    team_member: {
      description:
        "A synthesized team membership record (the add endpoint returns no body)",
      schema: TeamMembershipSchema,
      lifetime: "1h",
      garbageCollection: 5,
    },
    issue_comment: {
      description: "A single comment created on an issue",
      schema: CommentSchema,
      lifetime: "30m",
      garbageCollection: 5,
    },
    labels: {
      description: "Labels defined on a repository",
      schema: z.object({
        labels: z.array(RepoLabelSchema),
        count: z.number(),
        owner: z.string(),
        repo: z.string(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    label: {
      description: "A single label created on a repository",
      schema: RepoLabelSchema,
      lifetime: "1h",
      garbageCollection: 5,
    },
    milestones: {
      description: "Milestones defined on a repository",
      schema: z.object({
        milestones: z.array(MilestoneSchema),
        count: z.number(),
        owner: z.string(),
        repo: z.string(),
        state: z.string(),
      }),
      lifetime: "1h",
      garbageCollection: 5,
    },
    milestone: {
      description: "A single milestone created on a repository",
      schema: MilestoneSchema,
      lifetime: "1h",
      garbageCollection: 5,
    },
    issue_labels: {
      description: "The label set on an issue after an add-labels write",
      schema: z.object({
        labels: z.array(RepoLabelSchema),
        count: z.number(),
        owner: z.string(),
        repo: z.string(),
        index: z.number(),
      }),
      lifetime: "30m",
      garbageCollection: 5,
    },
  },

  methods: {
    list_repos: {
      description:
        "List repositories owned by or accessible to the authenticated user.",
      arguments: ListReposArgs,
      execute: async (
        args: z.infer<typeof ListReposArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        context.logger.info(
          "Listing repos from {host} (page {page}, limit {limit})",
          {
            host,
            page: args.page,
            limit: args.limit,
          },
        );

        const data = await apiGet(
          host,
          token,
          userReposPath(args.page, args.limit),
        );

        const repos = z.array(RepoSchema).parse(data);
        const handle = await context.writeResource("repos", "main", {
          repos,
          count: repos.length,
          page: args.page,
          limit: args.limit,
        });

        context.logger.info("Fetched {count} repos", { count: repos.length });
        return { dataHandles: [handle] };
      },
    },

    get_repo: {
      description: "Get details for a specific repository.",
      arguments: GetRepoArgs,
      execute: async (args: z.infer<typeof GetRepoArgs>, context: Context) => {
        const { host, token } = context.globalArgs;
        context.logger.info("Getting repo {owner}/{repo}", {
          owner: args.owner,
          repo: args.repo,
        });

        const data = await apiGet(host, token, repoPath(args.owner, args.repo));
        const repo = RepoSchema.parse(data);
        const handle = await context.writeResource(
          "repo",
          instanceName(args.owner, args.repo),
          repo,
        );

        context.logger.info("Fetched repo {fullName}", {
          fullName: repo.full_name,
        });
        return { dataHandles: [handle] };
      },
    },

    list_issues: {
      description: "List issues for a repository.",
      arguments: ListIssuesArgs,
      execute: async (
        args: z.infer<typeof ListIssuesArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        context.logger.info(
          "Listing {state} issues for {owner}/{repo} (page {page})",
          {
            state: args.state,
            owner: args.owner,
            repo: args.repo,
            page: args.page,
          },
        );

        const data = await apiGet(
          host,
          token,
          issuesPath(args.owner, args.repo, args.state, args.page, args.limit),
        );

        const issues = z.array(IssueSchema).parse(data).map(normalizeIssue);
        const handle = await context.writeResource(
          "issues",
          instanceName(args.owner, args.repo),
          {
            issues,
            count: issues.length,
            owner: args.owner,
            repo: args.repo,
            state: args.state,
            page: args.page,
            limit: args.limit,
          },
        );

        context.logger.info("Fetched {count} issues for {owner}/{repo}", {
          count: issues.length,
          owner: args.owner,
          repo: args.repo,
        });
        return { dataHandles: [handle] };
      },
    },

    get_issue: {
      description: "Get a specific issue by number.",
      arguments: GetIssueArgs,
      execute: async (args: z.infer<typeof GetIssueArgs>, context: Context) => {
        const { host, token } = context.globalArgs;
        context.logger.info("Getting issue #{index} in {owner}/{repo}", {
          index: args.index,
          owner: args.owner,
          repo: args.repo,
        });

        const data = await apiGet(
          host,
          token,
          issuePath(args.owner, args.repo, args.index),
        );

        const issue = normalizeIssue(IssueSchema.parse(data));
        const handle = await context.writeResource(
          "issue",
          instanceName(args.owner, args.repo, args.index),
          issue,
        );

        context.logger.info("Fetched issue #{number}: {title}", {
          number: issue.number,
          title: issue.title,
        });
        return { dataHandles: [handle] };
      },
    },

    list_pulls: {
      description: "List pull requests for a repository.",
      arguments: ListPullsArgs,
      execute: async (
        args: z.infer<typeof ListPullsArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        context.logger.info(
          "Listing {state} pull requests for {owner}/{repo} (page {page})",
          {
            state: args.state,
            owner: args.owner,
            repo: args.repo,
            page: args.page,
          },
        );

        const data = await apiGet(
          host,
          token,
          pullsPath(args.owner, args.repo, args.state, args.page, args.limit),
        );

        const pulls = z.array(PullRequestSchema).parse(data).map(normalizePull);
        const handle = await context.writeResource(
          "pulls",
          instanceName(args.owner, args.repo),
          {
            pulls,
            count: pulls.length,
            owner: args.owner,
            repo: args.repo,
            state: args.state,
            page: args.page,
            limit: args.limit,
          },
        );

        context.logger.info(
          "Fetched {count} pull requests for {owner}/{repo}",
          {
            count: pulls.length,
            owner: args.owner,
            repo: args.repo,
          },
        );
        return { dataHandles: [handle] };
      },
    },

    get_pull: {
      description: "Get a specific pull request by number.",
      arguments: GetPullArgs,
      execute: async (args: z.infer<typeof GetPullArgs>, context: Context) => {
        const { host, token } = context.globalArgs;
        context.logger.info("Getting pull request #{index} in {owner}/{repo}", {
          index: args.index,
          owner: args.owner,
          repo: args.repo,
        });

        const data = await apiGet(
          host,
          token,
          pullPath(args.owner, args.repo, args.index),
        );

        const pull = normalizePull(PullRequestSchema.parse(data));
        const handle = await context.writeResource(
          "pull",
          instanceName(args.owner, args.repo, args.index),
          pull,
        );

        context.logger.info("Fetched pull request #{number}: {title}", {
          number: pull.number,
          title: pull.title,
        });
        return { dataHandles: [handle] };
      },
    },

    list_releases: {
      description: "List releases for a repository.",
      arguments: ListReleasesArgs,
      execute: async (
        args: z.infer<typeof ListReleasesArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        context.logger.info(
          "Listing releases for {owner}/{repo} (page {page})",
          {
            owner: args.owner,
            repo: args.repo,
            page: args.page,
          },
        );

        const data = await apiGet(
          host,
          token,
          releasesPath(args.owner, args.repo, args.page, args.limit),
        );

        const releases = z.array(ReleaseSchema).parse(data);
        const handle = await context.writeResource(
          "releases",
          instanceName(args.owner, args.repo),
          {
            releases,
            count: releases.length,
            owner: args.owner,
            repo: args.repo,
            page: args.page,
            limit: args.limit,
          },
        );

        context.logger.info("Fetched {count} releases for {owner}/{repo}", {
          count: releases.length,
          owner: args.owner,
          repo: args.repo,
        });
        return { dataHandles: [handle] };
      },
    },

    list_deploy_keys: {
      description:
        "List deploy keys registered on a repository (verify-first before create).",
      arguments: ListDeployKeysArgs,
      execute: async (
        args: z.infer<typeof ListDeployKeysArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        context.logger.info("Listing deploy keys for {owner}/{repo}", {
          owner: args.owner,
          repo: args.repo,
        });

        const data = await apiGet(
          host,
          token,
          deployKeysPath(args.owner, args.repo),
        );

        const keys = z.array(DeployKeySchema).parse(data);
        const handle = await context.writeResource(
          "deploy_keys",
          instanceName(args.owner, args.repo),
          { keys, count: keys.length, owner: args.owner, repo: args.repo },
        );

        context.logger.info("Fetched {count} deploy keys for {owner}/{repo}", {
          count: keys.length,
          owner: args.owner,
          repo: args.repo,
        });
        return { dataHandles: [handle] };
      },
    },

    create_deploy_key: {
      description:
        "Register a deploy key on a repository. Defaults to read-only (least privilege).",
      arguments: CreateDeployKeyArgs,
      execute: async (
        args: z.infer<typeof CreateDeployKeyArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        context.logger.info(
          "Creating {mode} deploy key {title} on {owner}/{repo}",
          {
            mode: args.read_only ? "read-only" : "read/write",
            title: args.title,
            owner: args.owner,
            repo: args.repo,
          },
        );

        const data = await apiPost(
          host,
          token,
          deployKeysPath(args.owner, args.repo),
          { title: args.title, key: args.key, read_only: args.read_only },
        );

        const key = DeployKeySchema.parse(data);
        const handle = await context.writeResource(
          "deploy_key",
          instanceName(args.owner, args.repo, key.id),
          key,
        );

        context.logger.info("Created deploy key #{id} ({fingerprint})", {
          id: key.id,
          fingerprint: key.fingerprint,
        });
        return { dataHandles: [handle] };
      },
    },

    create_repo: {
      description:
        "Create a repository owned by the authenticated user (POST /user/repos). Confirm-gated (a live mutation). Push existing history afterwards, or set auto_init to seed an initial commit.",
      arguments: CreateRepoArgs,
      execute: async (
        args: z.infer<typeof CreateRepoArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to create repository without confirm:true (a live mutation).",
          );
        }
        context.logger.info("Creating {vis} repo {name} on {host}", {
          vis: args.private ? "private" : "public",
          name: args.name,
          host,
        });

        const data = await apiPost(host, token, "/user/repos", {
          name: args.name,
          description: args.description,
          private: args.private,
          auto_init: args.auto_init,
          default_branch: args.default_branch,
        });

        const repo = RepoSchema.parse(data);
        const handle = await context.writeResource(
          "repo",
          instanceName(repo.owner.login, repo.name),
          repo,
        );

        context.logger.info("Created repo {full_name} ({clone_url})", {
          full_name: repo.full_name,
          clone_url: repo.clone_url,
        });
        return { dataHandles: [handle] };
      },
    },

    create_org_repo: {
      description:
        "Create a repository owned by an organization (POST /orgs/{org}/repos). Confirm-gated (a live mutation).",
      arguments: CreateOrgRepoArgs,
      execute: async (
        args: z.infer<typeof CreateOrgRepoArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to create repository without confirm:true (a live mutation).",
          );
        }
        context.logger.info("Creating {vis} repo {name} in org {org}", {
          vis: args.private ? "private" : "public",
          name: args.name,
          org: args.org,
        });

        const data = await apiPost(host, token, orgReposPath(args.org), {
          name: args.name,
          description: args.description,
          private: args.private,
          auto_init: args.auto_init,
          default_branch: args.default_branch,
        });

        const repo = RepoSchema.parse(data);
        const handle = await context.writeResource(
          "repo",
          instanceName(repo.owner.login, repo.name),
          repo,
        );

        context.logger.info("Created repo {full_name} ({clone_url})", {
          full_name: repo.full_name,
          clone_url: repo.clone_url,
        });
        return { dataHandles: [handle] };
      },
    },

    edit_repo: {
      description:
        "Edit a repository's settings (PATCH /repos/{owner}/{repo}). Only provided fields are sent. Confirm-gated (a live mutation).",
      arguments: EditRepoArgs,
      execute: async (args: z.infer<typeof EditRepoArgs>, context: Context) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to edit repository without confirm:true (a live mutation).",
          );
        }
        context.logger.info("Editing repo {owner}/{repo}", {
          owner: args.owner,
          repo: args.repo,
        });

        const body: Record<string, unknown> = {};
        if (args.private !== undefined) body.private = args.private;
        if (args.description !== undefined) body.description = args.description;
        if (args.default_branch !== undefined) {
          body.default_branch = args.default_branch;
        }
        if (args.archived !== undefined) body.archived = args.archived;

        const data = await apiPatch(
          host,
          token,
          repoBasePath(args.owner, args.repo),
          body,
        );

        const repo = RepoSchema.parse(data);
        const handle = await context.writeResource(
          "repo",
          instanceName(args.owner, args.repo),
          repo,
        );

        context.logger.info("Edited repo {full_name}", {
          full_name: repo.full_name,
        });
        return { dataHandles: [handle] };
      },
    },

    delete_repo: {
      description:
        "Delete a repository (DELETE /repos/{owner}/{repo}). Destructive and confirm-gated: the driver should get_repo first to verify the target (Rule 5). No snapshot is written.",
      arguments: DeleteRepoArgs,
      execute: async (
        args: z.infer<typeof DeleteRepoArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to delete repository without confirm:true (a live mutation).",
          );
        }
        context.logger.info("Deleting repo {owner}/{repo}", {
          owner: args.owner,
          repo: args.repo,
        });

        await apiDelete(host, token, repoBasePath(args.owner, args.repo));

        context.logger.info("Deleted repo {owner}/{repo}", {
          owner: args.owner,
          repo: args.repo,
        });
        return { dataHandles: [] };
      },
    },

    list_orgs: {
      description:
        "List organizations the authenticated user belongs to (GET /user/orgs).",
      arguments: ListOrgsArgs,
      execute: async (args: z.infer<typeof ListOrgsArgs>, context: Context) => {
        const { host, token } = context.globalArgs;
        context.logger.info("Listing orgs (page {page}, limit {limit})", {
          page: args.page,
          limit: args.limit,
        });

        const data = await apiGet(
          host,
          token,
          `${orgsPath()}?page=${args.page}&limit=${args.limit}`,
        );

        const orgs = z.array(OrgSchema).parse(data);
        const handle = await context.writeResource("orgs", "main", {
          orgs,
          count: orgs.length,
          page: args.page,
          limit: args.limit,
        });

        context.logger.info("Fetched {count} orgs", { count: orgs.length });
        return { dataHandles: [handle] };
      },
    },

    list_org_repos: {
      description:
        "List repositories owned by an organization (GET /orgs/{org}/repos).",
      arguments: ListOrgReposArgs,
      execute: async (
        args: z.infer<typeof ListOrgReposArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        context.logger.info("Listing repos for org {org} (page {page})", {
          org: args.org,
          page: args.page,
        });

        const data = await apiGet(
          host,
          token,
          `${orgReposPath(args.org)}?page=${args.page}&limit=${args.limit}`,
        );

        const repos = z.array(RepoSchema).parse(data);
        const handle = await context.writeResource("org_repos", args.org, {
          repos,
          count: repos.length,
          org: args.org,
          page: args.page,
          limit: args.limit,
        });

        context.logger.info("Fetched {count} repos for org {org}", {
          count: repos.length,
          org: args.org,
        });
        return { dataHandles: [handle] };
      },
    },

    get_user: {
      description: "Get a user account by login (GET /users/{username}).",
      arguments: GetUserArgs,
      execute: async (args: z.infer<typeof GetUserArgs>, context: Context) => {
        const { host, token } = context.globalArgs;
        context.logger.info("Getting user {username}", {
          username: args.username,
        });

        const data = await apiGet(host, token, userPath(args.username));
        const user = UserSchema.parse(data);
        const handle = await context.writeResource("user", args.username, user);

        context.logger.info("Fetched user {login}", { login: user.login });
        return { dataHandles: [handle] };
      },
    },

    list_collaborators: {
      description:
        "List collaborators on a repository (GET /repos/{owner}/{repo}/collaborators). Verify-first before add.",
      arguments: ListCollaboratorsArgs,
      execute: async (
        args: z.infer<typeof ListCollaboratorsArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        context.logger.info("Listing collaborators for {owner}/{repo}", {
          owner: args.owner,
          repo: args.repo,
        });

        const data = await apiGet(
          host,
          token,
          collaboratorsPath(args.owner, args.repo),
        );

        const collaborators = z.array(UserSchema).parse(data);
        const handle = await context.writeResource(
          "collaborators",
          instanceName(args.owner, args.repo),
          {
            collaborators,
            count: collaborators.length,
            owner: args.owner,
            repo: args.repo,
          },
        );

        context.logger.info(
          "Fetched {count} collaborators for {owner}/{repo}",
          { count: collaborators.length, owner: args.owner, repo: args.repo },
        );
        return { dataHandles: [handle] };
      },
    },

    add_collaborator: {
      description:
        "Add or update a collaborator on a repository (PUT /repos/{owner}/{repo}/collaborators/{username}). Defaults to write permission (least privilege). Confirm-gated (a live mutation).",
      arguments: AddCollaboratorArgs,
      execute: async (
        args: z.infer<typeof AddCollaboratorArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to add collaborator without confirm:true (a live mutation).",
          );
        }
        context.logger.info(
          "Adding {username} to {owner}/{repo} as {permission}",
          {
            username: args.username,
            owner: args.owner,
            repo: args.repo,
            permission: args.permission,
          },
        );

        await apiPut(
          host,
          token,
          collaboratorPath(args.owner, args.repo, args.username),
          { permission: args.permission },
        );

        // The endpoint returns 204 No Content; synthesize the membership record.
        const handle = await context.writeResource(
          "collaborator",
          instanceKey(args.owner, args.repo, args.username),
          {
            owner: args.owner,
            repo: args.repo,
            username: args.username,
            permission: args.permission,
          },
        );

        context.logger.info("Added collaborator {username} to {owner}/{repo}", {
          username: args.username,
          owner: args.owner,
          repo: args.repo,
        });
        return { dataHandles: [handle] };
      },
    },

    remove_collaborator: {
      description:
        "Remove a collaborator from a repository (DELETE /repos/{owner}/{repo}/collaborators/{username}). Confirm-gated (a live mutation). No snapshot is written.",
      arguments: RemoveCollaboratorArgs,
      execute: async (
        args: z.infer<typeof RemoveCollaboratorArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to remove collaborator without confirm:true (a live mutation).",
          );
        }
        context.logger.info("Removing {username} from {owner}/{repo}", {
          username: args.username,
          owner: args.owner,
          repo: args.repo,
        });

        await apiDelete(
          host,
          token,
          collaboratorPath(args.owner, args.repo, args.username),
        );

        context.logger.info(
          "Removed collaborator {username} from {owner}/{repo}",
          { username: args.username, owner: args.owner, repo: args.repo },
        );
        return { dataHandles: [] };
      },
    },

    list_org_teams: {
      description: "List teams within an organization (GET /orgs/{org}/teams).",
      arguments: ListOrgTeamsArgs,
      execute: async (
        args: z.infer<typeof ListOrgTeamsArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        context.logger.info("Listing teams for org {org}", { org: args.org });

        const data = await apiGet(host, token, orgTeamsPath(args.org));
        const teams = z.array(TeamSchema).parse(data);
        const handle = await context.writeResource("org_teams", args.org, {
          teams,
          count: teams.length,
          org: args.org,
        });

        context.logger.info("Fetched {count} teams for org {org}", {
          count: teams.length,
          org: args.org,
        });
        return { dataHandles: [handle] };
      },
    },

    add_org_team_member: {
      description:
        "Add a user to a team (PUT /teams/{team_id}/members/{username}). Confirm-gated (a live mutation).",
      arguments: AddOrgTeamMemberArgs,
      execute: async (
        args: z.infer<typeof AddOrgTeamMemberArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to add team member without confirm:true (a live mutation).",
          );
        }
        context.logger.info("Adding {username} to team {team_id}", {
          username: args.username,
          team_id: args.team_id,
        });

        await apiPut(
          host,
          token,
          teamMemberPath(args.team_id, args.username),
        );

        // The endpoint returns 204 No Content; synthesize the membership record.
        const handle = await context.writeResource(
          "team_member",
          instanceKey(args.team_id, args.username),
          { team_id: args.team_id, username: args.username },
        );

        context.logger.info("Added {username} to team {team_id}", {
          username: args.username,
          team_id: args.team_id,
        });
        return { dataHandles: [handle] };
      },
    },

    create_issue: {
      description:
        "Create an issue in a repository (POST /repos/{owner}/{repo}/issues). Confirm-gated (a live mutation).",
      arguments: CreateIssueArgs,
      execute: async (
        args: z.infer<typeof CreateIssueArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to create issue without confirm:true (a live mutation).",
          );
        }
        context.logger.info("Creating issue {title} in {owner}/{repo}", {
          title: args.title,
          owner: args.owner,
          repo: args.repo,
        });

        const body: Record<string, unknown> = {
          title: args.title,
          body: args.body,
        };
        if (args.labels !== undefined) body.labels = args.labels;
        if (args.milestone !== undefined) body.milestone = args.milestone;
        if (args.assignees !== undefined) body.assignees = args.assignees;

        const data = await apiPost(
          host,
          token,
          issuesCreatePath(args.owner, args.repo),
          body,
        );

        const issue = normalizeIssue(IssueSchema.parse(data));
        const handle = await context.writeResource(
          "issue",
          instanceName(args.owner, args.repo, issue.number),
          issue,
        );

        context.logger.info("Created issue #{number}: {title}", {
          number: issue.number,
          title: issue.title,
        });
        return { dataHandles: [handle] };
      },
    },

    edit_issue: {
      description:
        "Edit an issue (PATCH /repos/{owner}/{repo}/issues/{index}). Only provided fields are sent; set state to open/closed to reopen/close. Confirm-gated (a live mutation).",
      arguments: EditIssueArgs,
      execute: async (
        args: z.infer<typeof EditIssueArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to edit issue without confirm:true (a live mutation).",
          );
        }
        context.logger.info("Editing issue #{index} in {owner}/{repo}", {
          index: args.index,
          owner: args.owner,
          repo: args.repo,
        });

        const body: Record<string, unknown> = {};
        if (args.title !== undefined) body.title = args.title;
        if (args.body !== undefined) body.body = args.body;
        if (args.state !== undefined) body.state = args.state;
        // Milestone tri-state: explicit clear (0) wins, else set if provided,
        // else leave unchanged (field absent). The schema's refine already
        // forbids setting both clear_milestone and milestone.
        if (args.clear_milestone) body.milestone = 0;
        else if (args.milestone !== undefined) body.milestone = args.milestone;
        // assignees: omit to leave unchanged; [] clears; [names] replaces.
        if (args.assignees !== undefined) body.assignees = args.assignees;

        const data = await apiPatch(
          host,
          token,
          issueEditPath(args.owner, args.repo, args.index),
          body,
        );

        const issue = normalizeIssue(IssueSchema.parse(data));
        const handle = await context.writeResource(
          "issue",
          instanceName(args.owner, args.repo, args.index),
          issue,
        );

        context.logger.info("Edited issue #{number}: {title}", {
          number: issue.number,
          title: issue.title,
        });
        return { dataHandles: [handle] };
      },
    },

    create_issue_comment: {
      description:
        "Comment on an issue (POST /repos/{owner}/{repo}/issues/{index}/comments). Confirm-gated (a live mutation).",
      arguments: CreateIssueCommentArgs,
      execute: async (
        args: z.infer<typeof CreateIssueCommentArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to create comment without confirm:true (a live mutation).",
          );
        }
        context.logger.info(
          "Commenting on issue #{index} in {owner}/{repo}",
          { index: args.index, owner: args.owner, repo: args.repo },
        );

        const data = await apiPost(
          host,
          token,
          issueCommentsPath(args.owner, args.repo, args.index),
          { body: args.body },
        );

        const comment = CommentSchema.parse(data);
        const handle = await context.writeResource(
          "issue_comment",
          instanceKey(args.owner, args.repo, args.index, comment.id),
          comment,
        );

        context.logger.info("Created comment #{id} on issue #{index}", {
          id: comment.id,
          index: args.index,
        });
        return { dataHandles: [handle] };
      },
    },

    create_user: {
      description:
        "Create a normal user account (POST /admin/users). Requires the model's token to have SITE-ADMIN privileges; the created account is a normal (non-admin) user. Defaults to least privilege: must_change_password=true, restricted=false, visibility=private. Confirm-gated (a live mutation).",
      arguments: CreateUserArgs,
      execute: async (
        args: z.infer<typeof CreateUserArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to create user without confirm:true (a live mutation).",
          );
        }
        context.logger.info("Creating {vis} user {username} on {host}", {
          vis: args.visibility,
          username: args.username,
          host,
        });

        const data = await apiPost(host, token, adminUsersPath(), {
          username: args.username,
          email: args.email,
          password: args.password,
          must_change_password: args.must_change_password,
          restricted: args.restricted,
          visibility: args.visibility,
        });

        const user = UserSchema.parse(data);
        // key off the server-assigned login (get_user keys off the input arg; both target the `user` resource)
        const handle = await context.writeResource("user", user.login, user);

        context.logger.info("Created user {login}", { login: user.login });
        return { dataHandles: [handle] };
      },
    },

    list_labels: {
      description:
        "List labels defined on a repository (GET /repos/{owner}/{repo}/labels). Verify-first before create_label. Excludes org-level labels (GET /orgs/{org}/labels), which org repos may also carry.",
      arguments: ListLabelsArgs,
      execute: async (
        args: z.infer<typeof ListLabelsArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        context.logger.info("Listing labels for {owner}/{repo} (page {page})", {
          owner: args.owner,
          repo: args.repo,
          page: args.page,
        });

        const data = await apiGet(
          host,
          token,
          `${
            labelsPath(args.owner, args.repo)
          }?page=${args.page}&limit=${args.limit}`,
        );

        const labels = z.array(RepoLabelSchema).parse(data);
        const handle = await context.writeResource(
          "labels",
          instanceName(args.owner, args.repo),
          { labels, count: labels.length, owner: args.owner, repo: args.repo },
        );

        context.logger.info("Fetched {count} labels for {owner}/{repo}", {
          count: labels.length,
          owner: args.owner,
          repo: args.repo,
        });
        return { dataHandles: [handle] };
      },
    },

    create_label: {
      description:
        "Create a label on a repository (POST /repos/{owner}/{repo}/labels). Confirm-gated (a live mutation). A BARE create: it does NOT check for an existing same-named label — verify-first with list_labels. Gitea/Forgejo does NOT enforce unique label names, and list_labels returns only one page by default, so page through before deciding a name is absent or a duplicate may be created.",
      arguments: CreateLabelArgs,
      execute: async (
        args: z.infer<typeof CreateLabelArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to create label without confirm:true (a live mutation).",
          );
        }
        const color = args.color.startsWith("#")
          ? args.color
          : `#${args.color}`;
        context.logger.info(
          "Creating label {name} ({color}) on {owner}/{repo}",
          {
            name: args.name,
            color,
            owner: args.owner,
            repo: args.repo,
          },
        );

        const data = await apiPost(
          host,
          token,
          labelsPath(args.owner, args.repo),
          {
            name: args.name,
            color,
            description: args.description,
            exclusive: args.exclusive,
            is_archived: args.is_archived,
          },
        );

        const label = RepoLabelSchema.parse(data);
        const handle = await context.writeResource(
          "label",
          instanceName(args.owner, args.repo, label.id),
          label,
        );

        context.logger.info("Created label #{id}: {name}", {
          id: label.id,
          name: label.name,
        });
        return { dataHandles: [handle] };
      },
    },

    list_milestones: {
      description:
        "List milestones on a repository (GET /repos/{owner}/{repo}/milestones). Verify-first before create_milestone. Only one page is returned by default.",
      arguments: ListMilestonesArgs,
      execute: async (
        args: z.infer<typeof ListMilestonesArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        context.logger.info(
          "Listing {state} milestones for {owner}/{repo} (page {page})",
          {
            state: args.state,
            owner: args.owner,
            repo: args.repo,
            page: args.page,
          },
        );

        const data = await apiGet(
          host,
          token,
          `${
            milestonesPath(args.owner, args.repo)
          }?state=${args.state}&page=${args.page}&limit=${args.limit}`,
        );

        const milestones = z.array(MilestoneSchema).parse(data).map(
          normalizeMilestone,
        );
        const handle = await context.writeResource(
          "milestones",
          instanceName(args.owner, args.repo),
          {
            milestones,
            count: milestones.length,
            owner: args.owner,
            repo: args.repo,
            state: args.state,
          },
        );

        context.logger.info("Fetched {count} milestones for {owner}/{repo}", {
          count: milestones.length,
          owner: args.owner,
          repo: args.repo,
        });
        return { dataHandles: [handle] };
      },
    },

    create_milestone: {
      description:
        "Create a milestone on a repository (POST /repos/{owner}/{repo}/milestones). Confirm-gated (a live mutation). A BARE create: it does NOT check for an existing same-titled milestone — verify-first with list_milestones (titles are not unique; only one page is returned by default).",
      arguments: CreateMilestoneArgs,
      execute: async (
        args: z.infer<typeof CreateMilestoneArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to create milestone without confirm:true (a live mutation).",
          );
        }
        context.logger.info("Creating milestone {title} on {owner}/{repo}", {
          title: args.title,
          owner: args.owner,
          repo: args.repo,
        });

        const body: Record<string, unknown> = {
          title: args.title,
          description: args.description,
          state: args.state,
        };
        if (args.due_on !== undefined) body.due_on = args.due_on;

        const data = await apiPost(
          host,
          token,
          milestonesPath(args.owner, args.repo),
          body,
        );

        const milestone = normalizeMilestone(MilestoneSchema.parse(data));
        const handle = await context.writeResource(
          "milestone",
          instanceName(args.owner, args.repo, milestone.id),
          milestone,
        );

        context.logger.info("Created milestone #{id}: {title}", {
          id: milestone.id,
          title: milestone.title,
        });
        return { dataHandles: [handle] };
      },
    },

    add_issue_labels: {
      description:
        "Add labels to an existing issue (POST /repos/{owner}/{repo}/issues/{index}/labels). Appends to the issue's existing labels. Label IDs are resolved by the caller from a list_labels snapshot. Confirm-gated (a live mutation).",
      arguments: AddIssueLabelsArgs,
      execute: async (
        args: z.infer<typeof AddIssueLabelsArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to add issue labels without confirm:true (a live mutation).",
          );
        }
        context.logger.info(
          "Adding {count} label(s) to issue #{index} in {owner}/{repo}",
          {
            count: args.labels.length,
            index: args.index,
            owner: args.owner,
            repo: args.repo,
          },
        );

        const data = await apiPost(
          host,
          token,
          issueLabelsPath(args.owner, args.repo, args.index),
          { labels: args.labels },
        );

        const labels = z.array(RepoLabelSchema).parse(data);
        const handle = await context.writeResource(
          "issue_labels",
          instanceName(args.owner, args.repo, args.index),
          {
            labels,
            count: labels.length,
            owner: args.owner,
            repo: args.repo,
            index: args.index,
          },
        );

        context.logger.info("Issue #{index} now carries {count} label(s)", {
          index: args.index,
          count: labels.length,
        });
        return { dataHandles: [handle] };
      },
    },

    create_pull: {
      description:
        "Open a pull request (POST /repos/{owner}/{repo}/pulls). Confirm-gated (a live mutation). A BARE create — verify-first with list_pulls (state=open) for an existing head->base PR before calling; Forgejo also rejects a duplicate open head->base PR server-side (409/422), so this is not idempotent on its own. `base` is required; resolve label/milestone IDs from list_labels/list_milestones snapshots. Reviewers are set via a separate endpoint and are not supported here.",
      arguments: CreatePullArgs,
      execute: async (
        args: z.infer<typeof CreatePullArgs>,
        context: Context,
      ) => {
        const { host, token } = context.globalArgs;
        if (!args.confirm) {
          throw new Error(
            "Refusing to create pull request without confirm:true (a live mutation).",
          );
        }
        context.logger.info(
          "Creating PR {title} ({head} -> {base}) in {owner}/{repo}",
          {
            title: args.title,
            head: args.head,
            base: args.base,
            owner: args.owner,
            repo: args.repo,
          },
        );

        const body: Record<string, unknown> = {
          title: args.title,
          head: args.head,
          base: args.base,
          body: args.body,
        };
        if (args.labels !== undefined) body.labels = args.labels;
        if (args.milestone !== undefined) body.milestone = args.milestone;
        if (args.assignees !== undefined) body.assignees = args.assignees;

        const data = await apiPost(
          host,
          token,
          pullsCreatePath(args.owner, args.repo),
          body,
        );

        const pull = normalizePull(PullRequestSchema.parse(data));
        const handle = await context.writeResource(
          "pull",
          instanceName(args.owner, args.repo, pull.number),
          pull,
        );

        context.logger.info(
          "Created PR #{number}: {title} ({head} -> {base})",
          {
            number: pull.number,
            title: pull.title,
            head: args.head,
            base: args.base,
          },
        );
        return { dataHandles: [handle] };
      },
    },
  },
};
