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

/** An issue/PR label. */
export const LabelSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  description: z.string(),
});

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
  draft: z.boolean(),
  merged: z.boolean(),
  mergeable: z.boolean().nullable(),
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
  closed_at: z.string().nullable(),
  merged_at: z.string().nullable(),
  merge_commit_sha: z.string().nullable(),
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
  labels: z.array(z.number().int()).optional().describe(
    "Label IDs to apply. Omit to apply none.",
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
  confirm: z.boolean().default(false).describe(
    "Must be true to edit the issue — this is a live mutation.",
  ),
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
  admin: z.boolean().default(false).describe(
    "Grant site-admin privileges (default false — least privilege).",
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

// ── Model ─────────────────────────────────────────────────────────────────────

/** The `@shrug/forgejo` model: read-only queries over the Forgejo/Gitea `/api/v1` REST surface. */
export const model = {
  type: "@shrug/forgejo",
  version: "2026.07.17.1",
  globalArguments: GlobalArgsSchema,

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

        const issues = z.array(IssueSchema).parse(data);
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

        const issue = IssueSchema.parse(data);
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

        const pulls = z.array(PullRequestSchema).parse(data);
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

        const pull = PullRequestSchema.parse(data);
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
        if (args.assignees !== undefined) body.assignees = args.assignees;

        const data = await apiPost(
          host,
          token,
          issuesCreatePath(args.owner, args.repo),
          body,
        );

        const issue = IssueSchema.parse(data);
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

        const data = await apiPatch(
          host,
          token,
          issueEditPath(args.owner, args.repo, args.index),
          body,
        );

        const issue = IssueSchema.parse(data);
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
        "Create a user account (POST /admin/users). Requires the model's token to have SITE-ADMIN privileges. Defaults to least privilege: must_change_password=true, admin=false, visibility=private. Confirm-gated (a live mutation).",
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
          admin: args.admin,
          restricted: args.restricted,
          visibility: args.visibility,
        });

        const user = UserSchema.parse(data);
        const handle = await context.writeResource("user", user.login, user);

        context.logger.info("Created user {login}", { login: user.login });
        return { dataHandles: [handle] };
      },
    },
  },
};
