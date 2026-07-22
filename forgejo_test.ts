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
  apiGet,
  apiPost,
  CreateDeployKeyArgs,
  DeployKeySchema,
  deployKeysPath,
  GlobalArgsSchema,
  instanceName,
  IssueSchema,
  issuePath,
  issuesPath,
  ListIssuesArgs,
  model,
  PullRequestSchema,
  pullPath,
  pullsPath,
  releasesPath,
  RepoSchema,
  repoPath,
  userReposPath,
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
    if (h) for (const [k, v] of Object.entries(h)) headers[k] = v;
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
  assert(p.includes("type=issues"), "list_issues MUST filter out pull requests");
  assertEquals(
    p,
    "/repos/shrug/infra/issues?type=issues&state=open&page=1&limit=50",
  );
});

Deno.test("issuesPath threads the state through", () => {
  assert(issuesPath("o", "r", "closed", 2, 10).includes("state=closed&page=2&limit=10"));
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
  assertEquals(releasesPath("o", "r", 1, 50), "/repos/o/r/releases?page=1&limit=50");
});

Deno.test("deployKeysPath builds the exact deploy-keys collection path", () => {
  assertEquals(deployKeysPath("o", "r"), "/repos/o/r/keys");
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
  assertEquals(meta?.sensitive, true, "token must carry sensitive:true metadata");
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
  assert(IssueSchema.safeParse({ ...ISSUE, state: "open", closed_at: null }).success);
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
  assertEquals((key as any).key_id, undefined, "unknown fields must be stripped");
  // deno-lint-ignore no-explicit-any
  assertEquals((key as any).repository, undefined, "unknown fields must be stripped");
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
  const mock = installMockFetch(() => new Response("Not Found", { status: 404 }));
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
    assertEquals(mock.calls[0].url, "https://git.shrug.pw/api/v1/repos/o/r/keys");
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
    assert(err.message.includes("key already in use"), "body text should be surfaced");
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
      const res = (model.resources as Record<string, { schema: { parse: (v: unknown) => unknown } }>)[resource];
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
    assertEquals(mock.calls[0].url, "https://git.shrug.pw/api/v1/repos/o/r/pulls/3");
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
    assertEquals(mock.calls[0].url, "https://git.shrug.pw/api/v1/user/repos?page=1&limit=50");
    assertEquals(written[0].resource, "repos");
    assertEquals(written[0].instance, "main", "list_repos keys the CEL-referenced 'main' instance");
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
    assertEquals(mock.calls[0].url, "https://git.shrug.pw/api/v1/repos/shrug/infra");
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
    assertEquals(mock.calls[0].url, "https://git.shrug.pw/api/v1/repos/o/r/issues/2");
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
    assertEquals(mock.calls[0].url, "https://git.shrug.pw/api/v1/repos/o/r/keys");
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
    assertEquals(mock.calls[0].url, "https://git.shrug.pw/api/v1/repos/o/r/keys");
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
