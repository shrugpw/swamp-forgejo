// Unit tests for the @shrug/forgejo extension model.
//
// Two layers:
//   1. Pure builders + schemas — path construction and Zod parse behaviour are
//      exercised in isolation (no context, no network). These pin the exact
//      query strings (e.g. list_issues' `type=issues` filter) and the optional/
//      nullable field contract the next-steps doc flagged as untested.
//   2. Method tests via a hand-rolled fake context + a mocked global `fetch`.
//      NO real HTTP happens: every fetch is intercepted, recorded, and answered
//      with a canned Response. This proves each method hits the right URL, sends
//      the token auth header, writes the right instance name, and surfaces API
//      errors.
//
// Run inside swamp's toolchain (where the jsr specifier resolves):
//   deno test extensions/forgejo/forgejo_test.ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  AddCollaboratorArgs,
  adminUsersPath,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  collaboratorPath,
  CollaboratorPermission,
  collaboratorsPath,
  CommentSchema,
  CreateDeployKeyArgs,
  CreateUserArgs,
  DeployKeySchema,
  deployKeysPath,
  GlobalArgsSchema,
  instanceKey,
  instanceName,
  issueCommentsPath,
  issueEditPath,
  issuePath,
  IssueSchema,
  issuesCreatePath,
  issuesPath,
  ListIssuesArgs,
  model,
  orgReposPath,
  OrgSchema,
  orgsPath,
  orgTeamsPath,
  pullPath,
  PullRequestSchema,
  pullsPath,
  releasesPath,
  repoBasePath,
  repoPath,
  RepoSchema,
  teamMemberPath,
  TeamSchema,
  userPath,
  userReposPath,
  UserSchema,
} from "./forgejo.ts";

// ── fetch interception ────────────────────────────────────────────────────────

interface RecordedFetch {
  url: string;
  headers: Record<string, string>;
  method?: string;
  body?: string;
}

// Install a fake global fetch. `handler(url)` returns the Response for each
// call. Records every request's URL + headers (and method/body, for POST
// assertions). Returns a restore fn (call in a finally).
function installMockFetch(
  handler: (url: string) => Response,
): { calls: RecordedFetch[]; restore: () => void } {
  const calls: RecordedFetch[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    const h = init?.headers as Record<string, string> | undefined;
    if (h) { for (const [k, v] of Object.entries(h)) headers[k] = v; }
    calls.push({
      url,
      headers,
      method: init?.method,
      body: init?.body as string | undefined,
    });
    return Promise.resolve(handler(url));
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = orig) };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const USER = {
  id: 1,
  login: "neil",
  full_name: "Neil Hanlon",
  email: "neil@example.com",
  html_url: "https://git.shrug.pw/neil",
  avatar_url: "https://git.shrug.pw/avatars/1",
};

// A PR as it appears in a *list* response: no additions/deletions/changed_files.
const PR_LIST_SHAPE = {
  id: 10,
  number: 3,
  title: "Add thing",
  state: "open",
  body: null,
  html_url: "https://git.shrug.pw/o/r/pulls/3",
  url: "https://git.shrug.pw/api/v1/repos/o/r/pulls/3",
  diff_url: "https://git.shrug.pw/o/r/pulls/3.diff",
  patch_url: "https://git.shrug.pw/o/r/pulls/3.patch",
  user: USER,
  labels: [],
  draft: false,
  merged: false,
  mergeable: null,
  comments: 0,
  review_comments: 0,
  head: { label: "feat", ref: "feat", sha: "abc" },
  base: { label: "main", ref: "main", sha: "def" },
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
  closed_at: null,
  merged_at: null,
  merge_commit_sha: null,
};

// The same PR from a *single* GET: diff stats populated.
const PR_GET_SHAPE = {
  ...PR_LIST_SHAPE,
  additions: 42,
  deletions: 7,
  changed_files: 3,
  mergeable: true,
};

const ISSUE = {
  id: 5,
  number: 2,
  title: "Bug",
  state: "closed",
  body: null,
  html_url: "https://git.shrug.pw/o/r/issues/2",
  url: "https://git.shrug.pw/api/v1/repos/o/r/issues/2",
  user: USER,
  labels: [],
  comments: 1,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-02T00:00:00Z",
  closed_at: "2026-04-02T00:00:00Z",
};

const DEPLOY_KEY = {
  id: 7,
  key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... swamp-serve-01",
  url: "https://git.shrug.pw/api/v1/repos/shrugpw/swamp/keys/7",
  title: "swamp-serve-01",
  fingerprint: "SHA256:abc123",
  created_at: "2026-07-22T00:00:00Z",
  read_only: true,
};

// ── 1. path builders (pure) ───────────────────────────────────────────────────

Deno.test("issuesPath pins type=issues so PRs are excluded", () => {
  const p = issuesPath("shrug", "infra", "open", 1, 50);
  assert(
    p.includes("type=issues"),
    "list_issues MUST filter out pull requests",
  );
  assertEquals(
    p,
    "/repos/shrug/infra/issues?type=issues&state=open&page=1&limit=50",
  );
});

Deno.test("issuesPath threads the state through", () => {
  assert(
    issuesPath("o", "r", "closed", 2, 10).includes(
      "state=closed&page=2&limit=10",
    ),
  );
});

Deno.test("pullsPath supports state=all (not smoke-tested upstream)", () => {
  assertEquals(
    pullsPath("o", "r", "all", 1, 50),
    "/repos/o/r/pulls?state=all&page=1&limit=50",
  );
});

Deno.test("remaining path builders are exact", () => {
  assertEquals(userReposPath(2, 25), "/user/repos?page=2&limit=25");
  assertEquals(repoPath("o", "r"), "/repos/o/r");
  assertEquals(issuePath("o", "r", 7), "/repos/o/r/issues/7");
  assertEquals(pullPath("o", "r", 9), "/repos/o/r/pulls/9");
  assertEquals(
    releasesPath("o", "r", 1, 50),
    "/repos/o/r/releases?page=1&limit=50",
  );
});

Deno.test("deployKeysPath builds the exact deploy-keys collection path", () => {
  assertEquals(deployKeysPath("o", "r"), "/repos/o/r/keys");
});

Deno.test("deployKeysPath percent-encodes owner/repo so a write can't be misdirected (SEC-1)", () => {
  // A crafted segment must not escape its path position and redirect the POST
  // (which mints an SSH credential) to another repo the PAT can reach.
  assertEquals(deployKeysPath("a/b", "r"), "/repos/a%2Fb/r/keys");
  assertEquals(deployKeysPath("o", "../evil"), "/repos/o/..%2Fevil/keys");
  assert(
    !deployKeysPath("o", "r?x=1#y").includes("?"),
    "query/fragment chars must be encoded",
  );
});

Deno.test("instanceName uses the __ separator CEL callers depend on", () => {
  assertEquals(instanceName("shrug", "infra"), "shrug__infra");
  assertEquals(instanceName("neil", "aoc2024", 12), "neil__aoc2024__12");
});

// ── 2. schemas ────────────────────────────────────────────────────────────────

Deno.test("GlobalArgsSchema requires a URL host and defaults metadata", () => {
  const ok = GlobalArgsSchema.safeParse({
    host: "https://git.shrug.pw",
    token: "t",
  });
  assert(ok.success);
  assertEquals(ok.data.metadata, {}, "metadata defaults to {}");

  assert(
    !GlobalArgsSchema.safeParse({ host: "not-a-url", token: "t" }).success,
    "a non-URL host must be rejected",
  );
});

Deno.test("GlobalArgsSchema marks the token sensitive", () => {
  // deno-lint-ignore no-explicit-any
  const meta = (GlobalArgsSchema.shape.token as any).meta?.();
  assertEquals(
    meta?.sensitive,
    true,
    "token must carry sensitive:true metadata",
  );
});

Deno.test("PullRequestSchema: list shape parses with diff stats absent", () => {
  const pr = PullRequestSchema.parse(PR_LIST_SHAPE);
  assertEquals(pr.additions, undefined);
  assertEquals(pr.deletions, undefined);
  assertEquals(pr.changed_files, undefined);
  assertEquals(pr.mergeable, null, "mergeable is nullable");
});

Deno.test("PullRequestSchema: get shape parses with diff stats present", () => {
  const pr = PullRequestSchema.parse(PR_GET_SHAPE);
  assertEquals(pr.additions, 42);
  assertEquals(pr.deletions, 7);
  assertEquals(pr.changed_files, 3);
  assertEquals(pr.mergeable, true);
});

Deno.test("IssueSchema: body/closed_at nullable, repository optional", () => {
  const issue = IssueSchema.parse(ISSUE);
  assertEquals(issue.body, null);
  assertEquals(issue.closed_at, "2026-04-02T00:00:00Z");
  assertEquals(issue.repository, undefined);
  // an open issue with a null closed_at also parses
  assert(
    IssueSchema.safeParse({ ...ISSUE, state: "open", closed_at: null }).success,
  );
});

Deno.test("RepoSchema: language is nullable", () => {
  const base = {
    id: 1,
    name: "r",
    full_name: "o/r",
    description: "",
    private: false,
    fork: false,
    template: false,
    mirror: false,
    archived: false,
    empty: false,
    html_url: "https://git.shrug.pw/o/r",
    ssh_url: "git@git.shrug.pw:o/r.git",
    clone_url: "https://git.shrug.pw/o/r.git",
    language: null,
    default_branch: "main",
    stars_count: 0,
    forks_count: 0,
    watchers_count: 0,
    open_issues_count: 0,
    open_pr_counter: 0,
    release_counter: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    owner: USER,
  };
  assert(RepoSchema.safeParse(base).success);
  assert(RepoSchema.safeParse({ ...base, language: "TypeScript" }).success);
});

Deno.test("DeployKeySchema parses the fixture and strips unknown fields", () => {
  const key = DeployKeySchema.parse({
    ...DEPLOY_KEY,
    key_id: 99,
    repository: { id: 1, full_name: "shrugpw/swamp" },
  });
  assertEquals(key.id, 7);
  assertEquals(key.fingerprint, "SHA256:abc123");
  assertEquals(key.read_only, true);
  // deno-lint-ignore no-explicit-any
  assertEquals(
    (key as any).key_id,
    undefined,
    "unknown fields must be stripped",
  );
  // deno-lint-ignore no-explicit-any
  assertEquals(
    (key as any).repository,
    undefined,
    "unknown fields must be stripped",
  );
});

Deno.test("CreateDeployKeyArgs defaults read_only to true when omitted", () => {
  const parsed = CreateDeployKeyArgs.parse({
    owner: "o",
    repo: "r",
    title: "t",
    key: "ssh-ed25519 AAAA...",
  });
  assertEquals(parsed.read_only, true);
});

// ── 3. apiGet (mocked fetch) ──────────────────────────────────────────────────

Deno.test("apiGet builds /api/v1 URL, strips trailing host slash, sends token auth", async () => {
  const mock = installMockFetch(() => jsonResponse({ ok: true }));
  try {
    const out = await apiGet("https://git.shrug.pw/", "s3cr3t", "/repos/o/r");
    assertEquals(mock.calls.length, 1);
    assertEquals(mock.calls[0].url, "https://git.shrug.pw/api/v1/repos/o/r");
    assertEquals(mock.calls[0].headers.Authorization, "token s3cr3t");
    assertEquals(mock.calls[0].headers.Accept, "application/json");
    assertEquals(out, { ok: true });
  } finally {
    mock.restore();
  }
});

Deno.test("apiGet throws on 404 with status + body", async () => {
  const mock = installMockFetch(() =>
    new Response("Not Found", { status: 404 })
  );
  try {
    await assertRejects(
      () => apiGet("https://git.shrug.pw", "t", "/repos/o/missing"),
      Error,
      "404",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("apiGet throws on 500 and includes the body text", async () => {
  const mock = installMockFetch(() => new Response("boom", { status: 500 }));
  try {
    const err = await assertRejects(
      () => apiGet("https://git.shrug.pw", "t", "/repos/o/r"),
      Error,
    );
    assert(err.message.includes("500"));
    assert(err.message.includes("boom"), "body text should be surfaced");
  } finally {
    mock.restore();
  }
});

Deno.test("apiPost builds /api/v1 URL, strips trailing host slash, sends token auth + JSON body", async () => {
  const mock = installMockFetch(() => jsonResponse({ ok: true }));
  try {
    const body = { title: "t", key: "ssh-ed25519 AAAA...", read_only: true };
    const out = await apiPost(
      "https://git.shrug.pw/",
      "s3cr3t",
      "/repos/o/r/keys",
      body,
    );
    assertEquals(mock.calls.length, 1);
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/o/r/keys",
    );
    assertEquals(mock.calls[0].method, "POST");
    assertEquals(mock.calls[0].headers.Authorization, "token s3cr3t");
    assertEquals(mock.calls[0].headers.Accept, "application/json");
    assertEquals(mock.calls[0].headers["Content-Type"], "application/json");
    assertEquals(mock.calls[0].body, JSON.stringify(body));
    assertEquals(out, { ok: true });
  } finally {
    mock.restore();
  }
});

Deno.test("apiPost throws on 422 with status + body", async () => {
  const mock = installMockFetch(() =>
    new Response("key already in use", { status: 422 })
  );
  try {
    const err = await assertRejects(
      () => apiPost("https://git.shrug.pw", "t", "/repos/o/r/keys", {}),
      Error,
      "422",
    );
    assert(
      err.message.includes("key already in use"),
      "body text should be surfaced",
    );
  } finally {
    mock.restore();
  }
});

// ── 4. method wiring (fake context + mocked fetch) ────────────────────────────

interface WrittenResource {
  resource: string;
  instance: string;
  // deno-lint-ignore no-explicit-any
  value: any;
}

// Minimal stand-in for the swamp method context. Captures writeResource calls
// and swallows logs. globalArgs is passed through verbatim (no Zod defaults).
// Like the real runtime, the fake writeResource validates the written value
// against the model's declared resource schema — so a method that drops or
// mis-shapes a written field fails here, not just under the explicit asserts.
function fakeContext(
  written: WrittenResource[],
  globalArgs: Record<string, unknown> = {
    host: "https://git.shrug.pw",
    token: "t",
    metadata: {},
  },
) {
  const noop = () => {};
  return {
    globalArgs,
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    // deno-lint-ignore no-explicit-any
    writeResource: (resource: string, instance: string, value: any) => {
      const res = (model.resources as Record<
        string,
        { schema: { parse: (v: unknown) => unknown } }
      >)[resource];
      assert(res, `unknown resource "${resource}"`);
      res.schema.parse(value); // throws if the written shape is wrong
      written.push({ resource, instance, value });
      return Promise.resolve({ resource, instance });
    },
  };
}

Deno.test("list_issues.execute hits the type=issues URL and writes owner__repo", async () => {
  const mock = installMockFetch(() => jsonResponse([ISSUE]));
  const written: WrittenResource[] = [];
  try {
    const res = await model.methods.list_issues.execute(
      { owner: "shrug", repo: "infra", state: "all", page: 1, limit: 50 },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assert(mock.calls[0].url.includes("/issues?type=issues&state=all"));
    assertEquals(written.length, 1);
    assertEquals(written[0].resource, "issues");
    assertEquals(written[0].instance, "shrug__infra");
    assertEquals(written[0].value.count, 1);
    assertEquals(written[0].value.state, "all");
    assertEquals(res.dataHandles.length, 1);
  } finally {
    mock.restore();
  }
});

Deno.test("get_pull.execute parses diff stats and writes owner__repo__index", async () => {
  const mock = installMockFetch(() => jsonResponse(PR_GET_SHAPE));
  const written: WrittenResource[] = [];
  try {
    await model.methods.get_pull.execute(
      { owner: "o", repo: "r", index: 3 },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/o/r/pulls/3",
    );
    assertEquals(written[0].instance, "o__r__3");
    assertEquals(written[0].value.additions, 42);
  } finally {
    mock.restore();
  }
});

Deno.test("list_releases.execute tolerates an empty release list", async () => {
  const mock = installMockFetch(() => jsonResponse([]));
  const written: WrittenResource[] = [];
  try {
    await model.methods.list_releases.execute(
      { owner: "o", repo: "r", page: 1, limit: 50 },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(written[0].value.count, 0);
    assertEquals(written[0].value.releases, []);
  } finally {
    mock.restore();
  }
});

Deno.test("a method surfaces an API error instead of writing a resource", async () => {
  const mock = installMockFetch(() => new Response("nope", { status: 403 }));
  const written: WrittenResource[] = [];
  try {
    await assertRejects(
      () =>
        model.methods.list_repos.execute(
          { page: 1, limit: 50 },
          // deno-lint-ignore no-explicit-any
          fakeContext(written) as any,
        ),
      Error,
      "403",
    );
    assertEquals(written.length, 0, "no resource should be written on failure");
  } finally {
    mock.restore();
  }
});

Deno.test("list_pulls.execute with state=open writes the pulls resource", async () => {
  const mock = installMockFetch(() => jsonResponse([PR_LIST_SHAPE]));
  const written: WrittenResource[] = [];
  try {
    await model.methods.list_pulls.execute(
      { owner: "o", repo: "r", state: "open", page: 1, limit: 50 },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assert(mock.calls[0].url.includes("/pulls?state=open"));
    assertEquals(written[0].resource, "pulls");
    assertEquals(written[0].value.pulls[0].additions, undefined);
  } finally {
    mock.restore();
  }
});

const REPO_SHAPE = {
  id: 1,
  name: "infra",
  full_name: "shrug/infra",
  description: "",
  private: false,
  fork: false,
  template: false,
  mirror: false,
  archived: false,
  empty: false,
  html_url: "https://git.shrug.pw/shrug/infra",
  ssh_url: "git@git.shrug.pw:shrug/infra.git",
  clone_url: "https://git.shrug.pw/shrug/infra.git",
  language: "TypeScript",
  default_branch: "main",
  stars_count: 0,
  forks_count: 0,
  watchers_count: 0,
  open_issues_count: 0,
  open_pr_counter: 0,
  release_counter: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  owner: USER,
};

Deno.test("list_repos.execute writes the repos resource at the 'main' instance", async () => {
  const mock = installMockFetch(() => jsonResponse([REPO_SHAPE]));
  const written: WrittenResource[] = [];
  try {
    await model.methods.list_repos.execute(
      { page: 1, limit: 50 },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/user/repos?page=1&limit=50",
    );
    assertEquals(written[0].resource, "repos");
    assertEquals(
      written[0].instance,
      "main",
      "list_repos keys the CEL-referenced 'main' instance",
    );
    assertEquals(written[0].value.count, 1);
    assertEquals(written[0].value.page, 1);
    assertEquals(written[0].value.limit, 50);
  } finally {
    mock.restore();
  }
});

Deno.test("get_repo.execute writes RepoSchema at owner__repo", async () => {
  const mock = installMockFetch(() => jsonResponse(REPO_SHAPE));
  const written: WrittenResource[] = [];
  try {
    await model.methods.get_repo.execute(
      { owner: "shrug", repo: "infra" },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/shrug/infra",
    );
    assertEquals(written[0].resource, "repo");
    assertEquals(written[0].instance, "shrug__infra");
    assertEquals(written[0].value.full_name, "shrug/infra");
  } finally {
    mock.restore();
  }
});

Deno.test("get_issue.execute writes IssueSchema at owner__repo__index", async () => {
  const mock = installMockFetch(() => jsonResponse(ISSUE));
  const written: WrittenResource[] = [];
  try {
    await model.methods.get_issue.execute(
      { owner: "o", repo: "r", index: 2 },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/o/r/issues/2",
    );
    assertEquals(written[0].resource, "issue");
    assertEquals(written[0].instance, "o__r__2");
    assertEquals(written[0].value.number, 2);
  } finally {
    mock.restore();
  }
});

// The framework applies Zod defaults before calling execute; pin that contract
// so a change to a default (state/page/limit) can't slip through unnoticed.
Deno.test("ListIssuesArgs applies state=open, page=1, limit=50 defaults", () => {
  const parsed = ListIssuesArgs.parse({ owner: "o", repo: "r" });
  assertEquals(parsed.state, "open");
  assertEquals(parsed.page, 1);
  assertEquals(parsed.limit, 50);
});

Deno.test("list_deploy_keys.execute GETs the keys collection and writes owner__repo", async () => {
  const mock = installMockFetch(() => jsonResponse([DEPLOY_KEY]));
  const written: WrittenResource[] = [];
  try {
    const res = await model.methods.list_deploy_keys.execute(
      { owner: "o", repo: "r" },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/o/r/keys",
    );
    assertEquals(written.length, 1);
    assertEquals(written[0].resource, "deploy_keys");
    assertEquals(written[0].instance, "o__r");
    assertEquals(written[0].value.count, 1);
    assertEquals(res.dataHandles.length, 1);
  } finally {
    mock.restore();
  }
});

Deno.test("create_deploy_key.execute POSTs the body and writes owner__repo__id", async () => {
  const mock = installMockFetch(() => jsonResponse(DEPLOY_KEY));
  const written: WrittenResource[] = [];
  try {
    await model.methods.create_deploy_key.execute(
      {
        owner: "o",
        repo: "r",
        title: "swamp-serve-01",
        key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... swamp-serve-01",
        read_only: true,
      },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/o/r/keys",
    );
    assertEquals(mock.calls[0].method, "POST");
    assertEquals(
      mock.calls[0].body,
      JSON.stringify({
        title: "swamp-serve-01",
        key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... swamp-serve-01",
        read_only: true,
      }),
    );
    assertEquals(written[0].resource, "deploy_key");
    assertEquals(written[0].instance, "o__r__7");
    assertEquals(written[0].value.read_only, true);
  } finally {
    mock.restore();
  }
});

Deno.test("create_deploy_key surfaces an API error instead of writing a resource", async () => {
  const mock = installMockFetch(() =>
    new Response("key already in use", { status: 422 })
  );
  const written: WrittenResource[] = [];
  try {
    await assertRejects(
      () =>
        model.methods.create_deploy_key.execute(
          {
            owner: "o",
            repo: "r",
            title: "dup",
            key: "ssh-ed25519 AAAA...",
            read_only: true,
          },
          // deno-lint-ignore no-explicit-any
          fakeContext(written) as any,
        ),
      Error,
      "422",
    );
    assertEquals(written.length, 0, "no resource should be written on failure");
  } finally {
    mock.restore();
  }
});

// ── 5. write-ops: fixtures ────────────────────────────────────────────────────

const ORG = {
  id: 3,
  username: "shrugpw",
  name: "shrugpw",
  full_name: "Shrug PW",
  description: "",
  visibility: "private",
  avatar_url: "https://git.shrug.pw/avatars/3",
};

const TEAM = {
  id: 4,
  name: "Owners",
  description: "org owners",
  permission: "owner",
};

const COMMENT = {
  id: 11,
  html_url: "https://git.shrug.pw/o/r/issues/2#issuecomment-11",
  body: "Looks good",
  user: USER,
  created_at: "2026-04-03T00:00:00Z",
  updated_at: "2026-04-03T00:00:00Z",
};

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

// ── 6. write-ops: path builders (pure) ────────────────────────────────────────

Deno.test("write/discovery path builders are exact", () => {
  assertEquals(orgReposPath("shrugpw"), "/orgs/shrugpw/repos");
  assertEquals(orgsPath(), "/user/orgs");
  assertEquals(orgTeamsPath("shrugpw"), "/orgs/shrugpw/teams");
  assertEquals(teamMemberPath(4, "neil"), "/teams/4/members/neil");
  assertEquals(repoBasePath("o", "r"), "/repos/o/r");
  assertEquals(collaboratorsPath("o", "r"), "/repos/o/r/collaborators");
  assertEquals(
    collaboratorPath("o", "r", "neil"),
    "/repos/o/r/collaborators/neil",
  );
  assertEquals(userPath("neil"), "/users/neil");
  assertEquals(issuesCreatePath("o", "r"), "/repos/o/r/issues");
  assertEquals(issueEditPath("o", "r", 7), "/repos/o/r/issues/7");
  assertEquals(issueCommentsPath("o", "r", 7), "/repos/o/r/issues/7/comments");
});

Deno.test("every write path builder percent-encodes every segment (SEC-1)", () => {
  // A crafted segment must not escape its path position and misdirect a live
  // mutation to another resource the PAT can reach.
  assertEquals(orgReposPath("a/b"), "/orgs/a%2Fb/repos");
  assertEquals(orgTeamsPath("a/b"), "/orgs/a%2Fb/teams");
  assertEquals(teamMemberPath(4, "a/b"), "/teams/4/members/a%2Fb");
  assertEquals(repoBasePath("a/b", "c/d"), "/repos/a%2Fb/c%2Fd");
  assertEquals(collaboratorsPath("a/b", "r"), "/repos/a%2Fb/r/collaborators");
  assertEquals(
    collaboratorPath("o", "r", "a/b"),
    "/repos/o/r/collaborators/a%2Fb",
  );
  assertEquals(userPath("a/b"), "/users/a%2Fb");
  assertEquals(issuesCreatePath("a/b", "r"), "/repos/a%2Fb/r/issues");

  // query/fragment characters must be encoded, not left to alter the URL
  const edit = issueEditPath("a/b", "r?x=1#y", 7);
  assertEquals(edit, "/repos/a%2Fb/r%3Fx%3D1%23y/issues/7");
  assert(!edit.includes("?") && !edit.includes("#"), "?/# must be encoded");
  const comments = issueCommentsPath("o", "r?x=1#y", 7);
  assert(
    !comments.includes("?x=1") && !comments.includes("#y"),
    "?/# must be encoded",
  );
});

Deno.test("instanceKey joins arbitrary segments with the __ separator", () => {
  assertEquals(instanceKey("o", "r", "neil"), "o__r__neil");
  assertEquals(instanceKey("o", "r", 7, 11), "o__r__7__11");
  assertEquals(instanceKey(4, "neil"), "4__neil");
});

Deno.test("instanceKey escapes segments so `__` inside a segment can't collide (CORR-1)", () => {
  // Without per-segment escaping these two distinct keys would both flatten to
  // "a__b__c__d" and corrupt each other's snapshots.
  assert(
    instanceKey("a", "b__c", "d") !== instanceKey("a__b", "c", "d"),
    "a segment containing `__` must not collide with a different segmentation",
  );
  // The `__` inside a segment survives as escaped underscores, not a boundary.
  assertEquals(instanceKey("a", "b__c", "d"), "a__b%5F%5Fc__d");
  assertEquals(instanceKey("a__b", "c", "d"), "a%5F%5Fb__c__d");
});

// ── 7. write-ops: schemas ─────────────────────────────────────────────────────

Deno.test("OrgSchema parses and strips extras", () => {
  const org = OrgSchema.parse({ ...ORG, website: "https://x", repo_count: 5 });
  assertEquals(org.id, 3);
  assertEquals(org.username, "shrugpw");
  assertEquals(org.visibility, "private");
  // deno-lint-ignore no-explicit-any
  assertEquals((org as any).website, undefined, "extras stripped");
});

Deno.test("OrgSchema parses with only `username` (no `name`)", () => {
  const org = OrgSchema.parse({ ...ORG, name: undefined });
  assertEquals(org.username, "shrugpw");
  assertEquals(org.name, undefined);
});

Deno.test("OrgSchema parses with only `name` (no `username`)", () => {
  const org = OrgSchema.parse({ ...ORG, username: undefined });
  assertEquals(org.name, "shrugpw");
  assertEquals(org.username, undefined);
});

Deno.test("OrgSchema rejects a payload with neither username nor name (TEST-2)", () => {
  const { username: _u, name: _n, ...rest } = ORG;
  assert(
    !OrgSchema.safeParse(rest).success,
    "an org with neither username nor name must not parse",
  );
});

Deno.test("TeamSchema parses and retains an optional units array (SPEC-1)", () => {
  const team = TeamSchema.parse({
    ...TEAM,
    units: ["repo.code", "repo.issues"],
  });
  assertEquals(team.id, 4);
  assertEquals(team.permission, "owner");
  assertEquals(team.units, ["repo.code", "repo.issues"]);
  // units is optional: a team object without it still parses
  const bare = TeamSchema.parse(TEAM);
  assertEquals(bare.units, undefined);
});

Deno.test("CommentSchema parses with an embedded user", () => {
  const c = CommentSchema.parse(COMMENT);
  assertEquals(c.id, 11);
  assertEquals(c.user.login, "neil");
});

Deno.test("CollaboratorPermission accepts read/write/admin only", () => {
  assert(CollaboratorPermission.safeParse("read").success);
  assert(CollaboratorPermission.safeParse("write").success);
  assert(CollaboratorPermission.safeParse("admin").success);
  assert(!CollaboratorPermission.safeParse("owner").success);
});

Deno.test("AddCollaboratorArgs defaults permission to write (least privilege) (TEST-1)", () => {
  const parsed = AddCollaboratorArgs.parse({
    owner: "o",
    repo: "r",
    username: "neil",
  });
  assertEquals(parsed.permission, "write");
});

// ── 8. write-ops: API helpers (mocked fetch) ──────────────────────────────────

Deno.test("apiPatch sends PATCH with JSON body + token auth", async () => {
  const mock = installMockFetch(() => jsonResponse({ ok: true }));
  try {
    const body = { description: "new" };
    const out = await apiPatch(
      "https://git.shrug.pw/",
      "s3cr3t",
      "/repos/o/r",
      body,
    );
    assertEquals(mock.calls[0].url, "https://git.shrug.pw/api/v1/repos/o/r");
    assertEquals(mock.calls[0].method, "PATCH");
    assertEquals(mock.calls[0].headers.Authorization, "token s3cr3t");
    assertEquals(mock.calls[0].headers["Content-Type"], "application/json");
    assertEquals(mock.calls[0].body, JSON.stringify(body));
    assertEquals(out, { ok: true });
  } finally {
    mock.restore();
  }
});

Deno.test("apiPatch throws on non-2xx with status + body and names PATCH", async () => {
  const mock = installMockFetch(() => new Response("bad", { status: 422 }));
  try {
    const err = await assertRejects(
      () => apiPatch("https://git.shrug.pw", "t", "/repos/o/r", {}),
      Error,
      "422",
    );
    assert(err.message.includes("PATCH"));
    assert(err.message.includes("bad"));
  } finally {
    mock.restore();
  }
});

Deno.test("apiPut with a body sends PUT + JSON and parses the response", async () => {
  const mock = installMockFetch(() => jsonResponse({ ok: true }));
  try {
    const body = { permission: "write" };
    const out = await apiPut(
      "https://git.shrug.pw/",
      "s3cr3t",
      "/repos/o/r/collaborators/neil",
      body,
    );
    assertEquals(mock.calls[0].method, "PUT");
    assertEquals(mock.calls[0].headers["Content-Type"], "application/json");
    assertEquals(mock.calls[0].body, JSON.stringify(body));
    assertEquals(out, { ok: true });
  } finally {
    mock.restore();
  }
});

Deno.test("apiPut returns null on a 204 empty body and omits Content-Type when body-less", async () => {
  const mock = installMockFetch(() => emptyResponse(204));
  try {
    const out = await apiPut(
      "https://git.shrug.pw",
      "t",
      "/teams/4/members/neil",
    );
    assertEquals(out, null, "204 empty body -> null, never .json()");
    assertEquals(mock.calls[0].method, "PUT");
    assertEquals(mock.calls[0].body, undefined, "no body sent");
    assertEquals(
      mock.calls[0].headers["Content-Type"],
      undefined,
      "no Content-Type when body-less",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("apiPut throws on non-2xx with status + body and names PUT", async () => {
  const mock = installMockFetch(() => new Response("nope", { status: 403 }));
  try {
    const err = await assertRejects(
      () => apiPut("https://git.shrug.pw", "t", "/x", { a: 1 }),
      Error,
      "403",
    );
    assert(err.message.includes("PUT"));
    assert(err.message.includes("nope"));
  } finally {
    mock.restore();
  }
});

Deno.test("apiDelete returns null on 204 and sends DELETE + token auth", async () => {
  const mock = installMockFetch(() => emptyResponse(204));
  try {
    const out = await apiDelete(
      "https://git.shrug.pw/",
      "s3cr3t",
      "/repos/o/r",
    );
    assertEquals(out, null);
    assertEquals(mock.calls[0].url, "https://git.shrug.pw/api/v1/repos/o/r");
    assertEquals(mock.calls[0].method, "DELETE");
    assertEquals(mock.calls[0].headers.Authorization, "token s3cr3t");
  } finally {
    mock.restore();
  }
});

Deno.test("apiDelete throws on non-2xx with status + body and names DELETE", async () => {
  const mock = installMockFetch(() => new Response("missing", { status: 404 }));
  try {
    const err = await assertRejects(
      () => apiDelete("https://git.shrug.pw", "t", "/repos/o/r"),
      Error,
      "404",
    );
    assert(err.message.includes("DELETE"));
    assert(err.message.includes("missing"));
  } finally {
    mock.restore();
  }
});

// ── 9. write-ops: confirm gating (all mutating methods) ────────────────────────

Deno.test("every write method refuses without confirm:true (no fetch, no write)", async () => {
  const cases: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "create_org_repo", args: { org: "o", name: "r" } },
    { name: "edit_repo", args: { owner: "o", repo: "r" } },
    { name: "delete_repo", args: { owner: "o", repo: "r" } },
    {
      name: "add_collaborator",
      args: { owner: "o", repo: "r", username: "u", permission: "write" },
    },
    {
      name: "remove_collaborator",
      args: { owner: "o", repo: "r", username: "u" },
    },
    { name: "add_org_team_member", args: { team_id: 4, username: "u" } },
    {
      name: "create_issue",
      args: { owner: "o", repo: "r", title: "t", body: "" },
    },
    { name: "edit_issue", args: { owner: "o", repo: "r", index: 2 } },
    {
      name: "create_issue_comment",
      args: { owner: "o", repo: "r", index: 2, body: "b" },
    },
  ];
  for (const c of cases) {
    const mock = installMockFetch(() => {
      throw new Error("fetch must not be called without confirm");
    });
    const written: WrittenResource[] = [];
    try {
      await assertRejects(
        () =>
          // deno-lint-ignore no-explicit-any
          (model.methods as any)[c.name].execute(
            { ...c.args, confirm: false },
            // deno-lint-ignore no-explicit-any
            fakeContext(written) as any,
          ),
        Error,
        "confirm:true",
      );
      assertEquals(mock.calls.length, 0, `${c.name} must not fetch`);
      assertEquals(written.length, 0, `${c.name} must not write`);
    } finally {
      mock.restore();
    }
  }
});

// ── 10. write-ops: repo methods (mocked fetch) ────────────────────────────────

Deno.test("create_org_repo POSTs to /orgs/{org}/repos and writes owner__name", async () => {
  const mock = installMockFetch(() => jsonResponse(REPO_SHAPE));
  const written: WrittenResource[] = [];
  try {
    await model.methods.create_org_repo.execute(
      {
        org: "shrugpw",
        name: "infra",
        description: "",
        private: true,
        auto_init: false,
        default_branch: "main",
        confirm: true,
      },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/orgs/shrugpw/repos",
    );
    assertEquals(mock.calls[0].method, "POST");
    assertEquals(
      mock.calls[0].body,
      JSON.stringify({
        name: "infra",
        description: "",
        private: true,
        auto_init: false,
        default_branch: "main",
      }),
    );
    assertEquals(written[0].resource, "repo");
    assertEquals(written[0].instance, "neil__infra");
    assertEquals(written[0].value.full_name, "shrug/infra");
  } finally {
    mock.restore();
  }
});

Deno.test("edit_repo PATCHes only the provided fields and writes owner__repo", async () => {
  const mock = installMockFetch(() => jsonResponse(REPO_SHAPE));
  const written: WrittenResource[] = [];
  try {
    await model.methods.edit_repo.execute(
      {
        owner: "shrug",
        repo: "infra",
        private: false,
        description: "new desc",
        confirm: true,
      },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/shrug/infra",
    );
    assertEquals(mock.calls[0].method, "PATCH");
    assertEquals(
      mock.calls[0].body,
      JSON.stringify({ private: false, description: "new desc" }),
      "only provided fields are sent",
    );
    assertEquals(written[0].resource, "repo");
    assertEquals(written[0].instance, "shrug__infra");
  } finally {
    mock.restore();
  }
});

Deno.test("edit_repo omits undefined fields entirely", async () => {
  const mock = installMockFetch(() => jsonResponse(REPO_SHAPE));
  const written: WrittenResource[] = [];
  try {
    await model.methods.edit_repo.execute(
      { owner: "o", repo: "r", description: "only this", confirm: true },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].body,
      JSON.stringify({ description: "only this" }),
    );
  } finally {
    mock.restore();
  }
});

Deno.test("delete_repo DELETEs and writes no snapshot (204)", async () => {
  const mock = installMockFetch(() => emptyResponse(204));
  const written: WrittenResource[] = [];
  try {
    const res = await model.methods.delete_repo.execute(
      { owner: "o", repo: "r", confirm: true },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(mock.calls[0].url, "https://git.shrug.pw/api/v1/repos/o/r");
    assertEquals(mock.calls[0].method, "DELETE");
    assertEquals(written.length, 0, "destructive delete writes no snapshot");
    assertEquals(res.dataHandles.length, 0);
  } finally {
    mock.restore();
  }
});

Deno.test("edit_repo/delete_repo route through the percent-encoding builder (SEC-1)", async () => {
  const mock = installMockFetch(() => emptyResponse(204));
  const written: WrittenResource[] = [];
  try {
    await model.methods.delete_repo.execute(
      { owner: "a/b", repo: "r", confirm: true },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/a%2Fb/r",
    );
  } finally {
    mock.restore();
  }
});

// ── 11. write-ops: discovery methods (mocked fetch) ───────────────────────────

Deno.test("list_orgs GETs /user/orgs with pagination and writes orgs@main", async () => {
  const mock = installMockFetch(() => jsonResponse([ORG]));
  const written: WrittenResource[] = [];
  try {
    await model.methods.list_orgs.execute(
      { page: 1, limit: 50 },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/user/orgs?page=1&limit=50",
    );
    assertEquals(written[0].resource, "orgs");
    assertEquals(written[0].instance, "main");
    assertEquals(written[0].value.count, 1);
  } finally {
    mock.restore();
  }
});

Deno.test("list_org_repos GETs /orgs/{org}/repos and writes org_repos@{org}", async () => {
  const mock = installMockFetch(() => jsonResponse([REPO_SHAPE]));
  const written: WrittenResource[] = [];
  try {
    await model.methods.list_org_repos.execute(
      { org: "shrugpw", page: 1, limit: 50 },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/orgs/shrugpw/repos?page=1&limit=50",
    );
    assertEquals(written[0].resource, "org_repos");
    assertEquals(written[0].instance, "shrugpw");
    assertEquals(written[0].value.count, 1);
    assertEquals(written[0].value.org, "shrugpw");
  } finally {
    mock.restore();
  }
});

Deno.test("get_user GETs /users/{username} and writes user@{username}", async () => {
  const mock = installMockFetch(() => jsonResponse(USER));
  const written: WrittenResource[] = [];
  try {
    await model.methods.get_user.execute(
      { username: "neil" },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(mock.calls[0].url, "https://git.shrug.pw/api/v1/users/neil");
    assertEquals(written[0].resource, "user");
    assertEquals(written[0].instance, "neil");
    assertEquals(written[0].value.login, "neil");
  } finally {
    mock.restore();
  }
});

Deno.test("list_collaborators GETs the collaborators collection and writes owner__repo", async () => {
  const mock = installMockFetch(() => jsonResponse([USER]));
  const written: WrittenResource[] = [];
  try {
    await model.methods.list_collaborators.execute(
      { owner: "o", repo: "r" },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/o/r/collaborators",
    );
    assertEquals(written[0].resource, "collaborators");
    assertEquals(written[0].instance, "o__r");
    assertEquals(written[0].value.count, 1);
  } finally {
    mock.restore();
  }
});

Deno.test("list_org_teams GETs /orgs/{org}/teams and writes org_teams@{org}", async () => {
  const mock = installMockFetch(() => jsonResponse([TEAM]));
  const written: WrittenResource[] = [];
  try {
    await model.methods.list_org_teams.execute(
      { org: "shrugpw" },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/orgs/shrugpw/teams",
    );
    assertEquals(written[0].resource, "org_teams");
    assertEquals(written[0].instance, "shrugpw");
    assertEquals(written[0].value.count, 1);
  } finally {
    mock.restore();
  }
});

// ── 12. write-ops: access/membership methods (mocked fetch, 204) ──────────────

Deno.test("add_collaborator PUTs {permission} and writes a synthesized membership (204)", async () => {
  const mock = installMockFetch(() => emptyResponse(204));
  const written: WrittenResource[] = [];
  try {
    await model.methods.add_collaborator.execute(
      {
        owner: "o",
        repo: "r",
        username: "neil",
        permission: "write",
        confirm: true,
      },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/o/r/collaborators/neil",
    );
    assertEquals(mock.calls[0].method, "PUT");
    assertEquals(mock.calls[0].body, JSON.stringify({ permission: "write" }));
    assertEquals(written[0].resource, "collaborator");
    assertEquals(written[0].instance, "o__r__neil");
    assertEquals(written[0].value, {
      owner: "o",
      repo: "r",
      username: "neil",
      permission: "write",
    });
  } finally {
    mock.restore();
  }
});

Deno.test("add_collaborator percent-encodes a hostile username segment (SEC-1)", async () => {
  const mock = installMockFetch(() => emptyResponse(204));
  const written: WrittenResource[] = [];
  try {
    await model.methods.add_collaborator.execute(
      {
        owner: "o",
        repo: "r",
        username: "a/b",
        permission: "write",
        confirm: true,
      },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/o/r/collaborators/a%2Fb",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("remove_collaborator DELETEs and writes no snapshot (204)", async () => {
  const mock = installMockFetch(() => emptyResponse(204));
  const written: WrittenResource[] = [];
  try {
    const res = await model.methods.remove_collaborator.execute(
      { owner: "o", repo: "r", username: "neil", confirm: true },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/o/r/collaborators/neil",
    );
    assertEquals(mock.calls[0].method, "DELETE");
    assertEquals(written.length, 0);
    assertEquals(res.dataHandles.length, 0);
  } finally {
    mock.restore();
  }
});

Deno.test("add_org_team_member PUTs (no body) and writes team_id__username (204)", async () => {
  const mock = installMockFetch(() => emptyResponse(204));
  const written: WrittenResource[] = [];
  try {
    await model.methods.add_org_team_member.execute(
      { team_id: 4, username: "neil", confirm: true },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/teams/4/members/neil",
    );
    assertEquals(mock.calls[0].method, "PUT");
    assertEquals(mock.calls[0].body, undefined, "no request body");
    assertEquals(written[0].resource, "team_member");
    assertEquals(written[0].instance, "4__neil");
    assertEquals(written[0].value, { team_id: 4, username: "neil" });
  } finally {
    mock.restore();
  }
});

// ── 13. write-ops: issue methods (mocked fetch) ───────────────────────────────

Deno.test("create_issue POSTs {title,body} and writes issue@owner__repo__number", async () => {
  const mock = installMockFetch(() => jsonResponse(ISSUE));
  const written: WrittenResource[] = [];
  try {
    await model.methods.create_issue.execute(
      { owner: "o", repo: "r", title: "Bug", body: "", confirm: true },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/o/r/issues",
    );
    assertEquals(mock.calls[0].method, "POST");
    assertEquals(
      mock.calls[0].body,
      JSON.stringify({ title: "Bug", body: "" }),
      "labels/assignees omitted when not provided",
    );
    assertEquals(written[0].resource, "issue");
    assertEquals(written[0].instance, "o__r__2", "keyed by response number");
    assertEquals(written[0].value.number, 2);
  } finally {
    mock.restore();
  }
});

Deno.test("create_issue includes labels + assignees when provided", async () => {
  const mock = installMockFetch(() => jsonResponse(ISSUE));
  const written: WrittenResource[] = [];
  try {
    await model.methods.create_issue.execute(
      {
        owner: "o",
        repo: "r",
        title: "Bug",
        body: "b",
        labels: [1, 2],
        assignees: ["neil"],
        confirm: true,
      },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].body,
      JSON.stringify({
        title: "Bug",
        body: "b",
        labels: [1, 2],
        assignees: ["neil"],
      }),
    );
  } finally {
    mock.restore();
  }
});

Deno.test("edit_issue PATCHes only provided fields and writes issue@owner__repo__index", async () => {
  const mock = installMockFetch(() => jsonResponse(ISSUE));
  const written: WrittenResource[] = [];
  try {
    await model.methods.edit_issue.execute(
      { owner: "o", repo: "r", index: 2, state: "closed", confirm: true },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/o/r/issues/2",
    );
    assertEquals(mock.calls[0].method, "PATCH");
    assertEquals(
      mock.calls[0].body,
      JSON.stringify({ state: "closed" }),
      "only provided fields are sent",
    );
    assertEquals(written[0].resource, "issue");
    assertEquals(written[0].instance, "o__r__2", "keyed by the arg index");
  } finally {
    mock.restore();
  }
});

Deno.test("edit_issue omits undefined fields entirely", async () => {
  const mock = installMockFetch(() => jsonResponse(ISSUE));
  const written: WrittenResource[] = [];
  try {
    await model.methods.edit_issue.execute(
      { owner: "o", repo: "r", index: 2, title: "renamed", confirm: true },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(mock.calls[0].body, JSON.stringify({ title: "renamed" }));
  } finally {
    mock.restore();
  }
});

Deno.test("create_issue_comment POSTs {body} and writes issue_comment@owner__repo__index__id", async () => {
  const mock = installMockFetch(() => jsonResponse(COMMENT));
  const written: WrittenResource[] = [];
  try {
    await model.methods.create_issue_comment.execute(
      { owner: "o", repo: "r", index: 2, body: "Looks good", confirm: true },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/o/r/issues/2/comments",
    );
    assertEquals(mock.calls[0].method, "POST");
    assertEquals(mock.calls[0].body, JSON.stringify({ body: "Looks good" }));
    assertEquals(written[0].resource, "issue_comment");
    assertEquals(written[0].instance, "o__r__2__11");
    assertEquals(written[0].value.id, 11);
  } finally {
    mock.restore();
  }
});

// ── 13b. write-ops: hostile-segment encoding, end-to-end (SEC-1 / TEST-3) ─────
// Each remaining mutating method must route its caller-supplied segments through
// the percent-encoding path builder so a crafted segment (`a/b`) can't escape
// its position and misdirect the live mutation.

Deno.test("create_org_repo percent-encodes a hostile org segment (TEST-3)", async () => {
  const mock = installMockFetch(() => jsonResponse(REPO_SHAPE));
  const written: WrittenResource[] = [];
  try {
    await model.methods.create_org_repo.execute(
      {
        org: "a/b",
        name: "infra",
        description: "",
        private: true,
        auto_init: false,
        default_branch: "main",
        confirm: true,
      },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/orgs/a%2Fb/repos",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("add_org_team_member percent-encodes a hostile username segment (TEST-3)", async () => {
  const mock = installMockFetch(() => emptyResponse(204));
  const written: WrittenResource[] = [];
  try {
    await model.methods.add_org_team_member.execute(
      { team_id: 4, username: "a/b", confirm: true },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/teams/4/members/a%2Fb",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("create_issue percent-encodes a hostile owner segment (TEST-3)", async () => {
  const mock = installMockFetch(() => jsonResponse(ISSUE));
  const written: WrittenResource[] = [];
  try {
    await model.methods.create_issue.execute(
      { owner: "a/b", repo: "r", title: "Bug", body: "", confirm: true },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/a%2Fb/r/issues",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("edit_issue percent-encodes a hostile owner segment (TEST-3)", async () => {
  const mock = installMockFetch(() => jsonResponse(ISSUE));
  const written: WrittenResource[] = [];
  try {
    await model.methods.edit_issue.execute(
      { owner: "a/b", repo: "r", index: 2, state: "closed", confirm: true },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/a%2Fb/r/issues/2",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("create_issue_comment percent-encodes a hostile owner segment (TEST-3)", async () => {
  const mock = installMockFetch(() => jsonResponse(COMMENT));
  const written: WrittenResource[] = [];
  try {
    await model.methods.create_issue_comment.execute(
      { owner: "a/b", repo: "r", index: 2, body: "hi", confirm: true },
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/repos/a%2Fb/r/issues/2/comments",
    );
  } finally {
    mock.restore();
  }
});

Deno.test("a confirmed write method surfaces an API error instead of writing", async () => {
  const mock = installMockFetch(() =>
    new Response("forbidden", { status: 403 })
  );
  const written: WrittenResource[] = [];
  try {
    await assertRejects(
      () =>
        model.methods.add_collaborator.execute(
          {
            owner: "o",
            repo: "r",
            username: "neil",
            permission: "write",
            confirm: true,
          },
          // deno-lint-ignore no-explicit-any
          fakeContext(written) as any,
        ),
      Error,
      "403",
    );
    assertEquals(written.length, 0, "no snapshot written on API failure");
  } finally {
    mock.restore();
  }
});

// ── 14. admin: create_user (site-admin, mocked fetch) ─────────────────────────

// A user account as returned by POST /admin/users.
const ADMIN_USER = {
  id: 12,
  login: "label",
  full_name: "Louis Abel",
  email: "label@example.com",
  html_url: "https://git.shrug.pw/label",
  avatar_url: "https://git.shrug.pw/avatars/12",
};

Deno.test("adminUsersPath builds the exact /admin/users collection path", () => {
  assertEquals(adminUsersPath(), "/admin/users");
});

Deno.test("CreateUserArgs applies least-privilege defaults", () => {
  const parsed = CreateUserArgs.parse({
    username: "label",
    email: "label@example.com",
    password: "s3cr3t",
  });
  assertEquals(parsed.must_change_password, true);
  assertEquals(parsed.restricted, false);
  assertEquals(parsed.visibility, "private");
  assertEquals(parsed.confirm, false);
});

Deno.test("CreateUserArgs marks the password sensitive", () => {
  // deno-lint-ignore no-explicit-any
  const meta = (CreateUserArgs.shape.password as any).meta?.();
  assertEquals(
    meta?.sensitive,
    true,
    "password must carry sensitive:true metadata",
  );
});

Deno.test("UserSchema parses an admin-created user response and strips extras", () => {
  const user = UserSchema.parse({
    ...ADMIN_USER,
    is_admin: true,
    restricted: false,
    created: "2026-09-19T00:00:00Z",
  });
  assertEquals(user.id, 12);
  assertEquals(user.login, "label");
  assertEquals(user.email, "label@example.com");
  // deno-lint-ignore no-explicit-any
  assertEquals((user as any).is_admin, undefined, "unknown fields stripped");
});

Deno.test("create_user POSTs /admin/users with defaults applied and writes user@{username}", async () => {
  const mock = installMockFetch(() => jsonResponse(ADMIN_USER));
  const written: WrittenResource[] = [];
  try {
    await model.methods.create_user.execute(
      CreateUserArgs.parse({
        username: "label",
        email: "label@example.com",
        password: "s3cr3t",
        confirm: true,
      }),
      // deno-lint-ignore no-explicit-any
      fakeContext(written) as any,
    );
    assertEquals(
      mock.calls[0].url,
      "https://git.shrug.pw/api/v1/admin/users",
    );
    assertEquals(mock.calls[0].method, "POST");
    assertEquals(
      mock.calls[0].body,
      JSON.stringify({
        username: "label",
        email: "label@example.com",
        password: "s3cr3t",
        must_change_password: true,
        restricted: false,
        visibility: "private",
      }),
      "body carries username/email/password plus the applied least-privilege defaults",
    );
    assertEquals(written[0].resource, "user");
    assertEquals(written[0].instance, "label", "keyed by the created login");
    assertEquals(written[0].value.login, "label");
  } finally {
    mock.restore();
  }
});

Deno.test("create_user refuses without confirm:true (no fetch, no write)", async () => {
  const mock = installMockFetch(() => {
    throw new Error("fetch must not be called without confirm");
  });
  const written: WrittenResource[] = [];
  try {
    await assertRejects(
      () =>
        model.methods.create_user.execute(
          CreateUserArgs.parse({
            username: "label",
            email: "label@example.com",
            password: "s3cr3t",
          }),
          // deno-lint-ignore no-explicit-any
          fakeContext(written) as any,
        ),
      Error,
      "confirm:true",
    );
    assertEquals(mock.calls.length, 0, "create_user must not fetch");
    assertEquals(written.length, 0, "create_user must not write");
  } finally {
    mock.restore();
  }
});
