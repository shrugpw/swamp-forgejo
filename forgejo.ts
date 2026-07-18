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
  },
};
