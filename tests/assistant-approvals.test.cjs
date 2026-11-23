const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Execute the actual inline workflow scripts, avoiding a second policy copy
// and a checkout of PR-controlled JavaScript in the org-required workflow.
const workflow = fs.readFileSync(
  path.join(
    __dirname,
    "../.github/workflows/org-required-assistant-approvals.yml",
  ),
  "utf8",
);
const scripts = [
  ...workflow.matchAll(
    /          script: \|\n((?:(?:            [^\n]*|)\n?)*)/g,
  ),
].map((match) =>
  match[1]
    .split("\n")
    .map((line) => line.slice(12))
    .join("\n"),
);
assert.equal(scripts.length, 3);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = (index, state, process = { env: {} }) =>
  new AsyncFunction(
    "github",
    "context",
    "core",
    "require",
    "process",
    scripts[index],
  )(state.github, state.context, state.core, require, process);

function fixture() {
  const head = "a".repeat(40),
    base = "b".repeat(40);
  const pr = {
    number: 42,
    user: { id: 224985224 },
    changed_files: 1,
    head: { sha: head, repo: { full_name: "grafana/deployment_tools" } },
    base: { sha: base },
  };
  const run = {
    id: 100,
    run_attempt: 1,
    head_sha: head,
    event: "pull_request",
    path: ".github/workflows/kube-manifests-exporter.yaml",
    status: "completed",
    conclusion: "success",
    head_repository: { full_name: "grafana/deployment_tools" },
    pull_requests: [{ number: 42, head: { sha: head }, base: { sha: base } }],
  };
  const expected = {
    pullNumber: 42,
    sourceHeadSha: head,
    sourceBaseSha: base,
    runId: 100,
    runAttempt: 1,
  };
  const state = {
    pr,
    run,
    expected,
    files: [
      {
        status: "modified",
        filename: "ksonnet/environments/assistant/main.jsonnet",
      },
    ],
    runs: [run],
    artifacts: [
      {
        id: 7,
        name: "assistant-resource-change-report-1",
        expired: false,
        size_in_bytes: 1000,
        workflow_run: { id: 100, head_sha: head },
      },
    ],
    report: {
      ...expected,
      schemaVersion: 1,
      policy: "assistant-resource-increases-v1",
      repository: "grafana/deployment_tools",
      renderSourceSha: "c".repeat(40),
      manifestBaseSha: "d".repeat(40),
      manifestHeadSha: "e".repeat(40),
      resourceIncreasesOnly: true,
      increases: 1,
    },
    reviews: [],
    outputs: {},
    failures: [],
    messages: [],
    summary: [],
    context: {
      repo: { owner: "grafana", repo: "deployment_tools" },
      eventName: "pull_request",
      payload: { pull_request: { number: 42, head: { sha: head } } },
    },
  };
  state.github = {
    rest: {
      pulls: {
        get: async () => ({ data: state.pr }),
        listFiles: "files",
        listReviews: "reviews",
      },
      actions: {
        listWorkflowRuns: async () => ({ data: { workflow_runs: state.runs } }),
        listWorkflowRunArtifacts: "artifacts",
        getWorkflowRun: async () => ({ data: state.run }),
      },
      repos: {
        getCollaboratorPermissionLevel: async ({ username }) => ({
          data: { permission: username === "reader" ? "read" : "write" },
        }),
      },
    },
    paginate: async (endpoint) => state[endpoint],
  };
  const summary = {};
  for (const method of ["addHeading", "addRaw", "addLink"]) {
    summary[method] = (...args) => {
      state.summary.push(args.join(" "));
      return summary;
    };
  }
  summary.write = async () => {};
  state.core = {
    info: (message) => state.messages.push(message),
    setFailed: (message) => state.failures.push(message),
    setOutput: (key, value) => {
      state.outputs[key] = value;
    },
    summary,
  };
  return state;
}

test("selects an exact successful exporter run and attempt", async () => {
  const state = fixture();
  await execute(1, state);
  assert.equal(state.outputs["artifact-id"], "7");
  assert.deepEqual(JSON.parse(state.outputs.expected), state.expected);
});

const rejectedSelections = {
  "non-Assistant author": (s) => {
    s.pr.user.id = 1;
  },
  "other repository": (s) => {
    s.context.repo.repo = "other";
  },
  "fork PR": (s) => {
    s.pr.head.repo.full_name = "someone/deployment_tools";
  },
  "old event": (s) => {
    s.context.payload.pull_request.head.sha = "f".repeat(40);
  },
  "mixed Terraform edit": (s) => {
    s.files.push({ status: "modified", filename: "terraform/main.tf" });
    s.pr.changed_files++;
  },
  "pipeline edit": (s) => {
    s.files[0].filename = ".github/workflows/kube-manifests-exporter.yaml";
  },
  "team access metadata": (s) => {
    s.files[0].filename = "ksonnet/lib/meta/teams/assistant.libsonnet";
  },
  "new source file": (s) => {
    s.files[0].status = "added";
  },
  "incomplete source file list": (s) => {
    s.pr.changed_files = 2;
  },
  "no source files": (s) => {
    s.files = [];
    s.pr.changed_files = 0;
  },
  "no run": (s) => {
    s.runs = [];
  },
  "newest run pending": (s) => {
    s.runs.push({ ...s.run, id: 101, status: "in_progress", conclusion: null });
  },
  "failed exporter": (s) => {
    s.run.conclusion = "failure";
  },
  "wrong workflow": (s) => {
    s.run.path = ".github/workflows/other.yaml";
  },
  "stale base": (s) => {
    s.run.pull_requests[0].base.sha = "f".repeat(40);
  },
  "wrong run head": (s) => {
    s.run.head_sha = "f".repeat(40);
  },
  "unrelated PR": (s) => {
    s.run.pull_requests[0].number = 43;
  },
  "wrong run repository": (s) => {
    s.run.head_repository.full_name = "someone/deployment_tools";
  },
  "missing report": (s) => {
    s.artifacts = [];
  },
  "ambiguous report": (s) => {
    s.artifacts.push({ ...s.artifacts[0], id: 8 });
  },
  "expired report": (s) => {
    s.artifacts[0].expired = true;
  },
  "oversized report": (s) => {
    s.artifacts[0].size_in_bytes = 1000000;
  },
  "old run attempt": (s) => {
    s.run.run_attempt = 2;
  },
  "wrong artifact head": (s) => {
    s.artifacts[0].workflow_run.head_sha = "f".repeat(40);
  },
  "wrong artifact run": (s) => {
    s.artifacts[0].workflow_run.id = 99;
  },
};
for (const [name, mutate] of Object.entries(rejectedSelections)) {
  test(`does not select: ${name}`, async () => {
    const state = fixture();
    mutate(state);
    await execute(1, state);
    assert.equal(state.outputs["artifact-id"], undefined);
    assert.deepEqual(state.failures, []); // observation never changes the gate
  });
}

test("merge queue uses the same report lookup", async () => {
  const state = fixture();
  state.context.eventName = "merge_group";
  state.context.payload = {
    merge_group: {
      head_ref: "refs/heads/gh-readonly-queue/master/pr-42-abcdef",
    },
  };
  await execute(1, state);
  assert.equal(state.outputs["artifact-id"], "7");
});

async function summarize(state, extraFile) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "assistant-report-test-"),
  );
  try {
    fs.writeFileSync(
      path.join(directory, "assistant-resource-change-report.json"),
      JSON.stringify(state.report),
    );
    if (extraFile) fs.writeFileSync(path.join(directory, "extra"), "untrusted");
    await execute(2, state, {
      env: {
        REPORT_DIRECTORY: directory,
        EXPECTED_REPORT: JSON.stringify(state.expected),
      },
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("valid candidate is explicitly reporting-only", async () => {
  const state = fixture();
  await summarize(state);
  assert.match(state.summary.join("\n"), /Candidate for one approval/);
  assert.match(state.summary.join("\n"), /two human approvals remain required/);
  assert.deepEqual(state.outputs, {}); // no enforcement output exists
});

test("negative report cannot claim a candidate", async () => {
  const state = fixture();
  state.report.resourceIncreasesOnly = false;
  state.report.increases = 0;
  await summarize(state);
  assert.match(state.summary.join("\n"), /Not a candidate/);
});

for (const [name, mutate] of Object.entries({
  "wrong schema": (s) => {
    s.report.schemaVersion = 2;
  },
  "wrong policy": (s) => {
    s.report.policy = "anything";
  },
  "wrong repository": (s) => {
    s.report.repository = "someone/deployment_tools";
  },
  "wrong source head": (s) => {
    s.report.sourceHeadSha = "f".repeat(40);
  },
  "wrong source base": (s) => {
    s.report.sourceBaseSha = "f".repeat(40);
  },
  "wrong attempt": (s) => {
    s.report.runAttempt = 2;
  },
  "malformed manifest sha": (s) => {
    s.report.manifestHeadSha = "main";
  },
  "unchanged manifests": (s) => {
    s.report.manifestHeadSha = s.report.manifestBaseSha;
  },
  "zero increases": (s) => {
    s.report.increases = 0;
  },
  "non-boolean eligibility": (s) => {
    s.report.resourceIncreasesOnly = "true";
  },
  "PR changed after download": (s) => {
    s.pr.head.sha = "f".repeat(40);
  },
  "run restarted after download": (s) => {
    s.run.run_attempt = 2;
  },
  "run now failed": (s) => {
    s.run.conclusion = "failure";
  },
})) {
  test(`rejects report: ${name}`, async () => {
    const state = fixture();
    mutate(state);
    await assert.rejects(summarize(state));
    assert.deepEqual(state.summary, []);
  });
}
test("rejects unexpected archive entries", async () => {
  await assert.rejects(summarize(fixture(), true), /archive contents/);
});

function approval(id, state, extra = {}) {
  return {
    id,
    user: { id, login: `reviewer${id}`, type: "User" },
    state: "APPROVED",
    commit_id: state.pr.head.sha,
    ...extra,
  };
}
test("one approval still fails even with a positive resource report", async () => {
  const state = fixture();
  state.reviews = [approval(1, state)];
  await summarize(state);
  await execute(0, state);
  assert.match(state.failures[0], /\(1\/2\)/);
});
test("two distinct current human approvals still pass", async () => {
  const state = fixture();
  state.reviews = [approval(1, state), approval(2, state)];
  await execute(0, state);
  assert.deepEqual(state.failures, []);
});
test("stale, bot, read-only, duplicate and revoked approvals do not count", async () => {
  const state = fixture();
  state.reviews = [
    approval(1, state),
    approval(2, state, { user: { id: 1, login: "reviewer1", type: "User" } }),
    approval(3, state, { commit_id: "f".repeat(40) }),
    approval(4, state, { user: { id: 4, login: "bot", type: "Bot" } }),
    approval(5, state, { user: { id: 5, login: "reader", type: "User" } }),
    approval(6, state),
    approval(7, state, {
      state: "DISMISSED",
      user: { id: 6, login: "reviewer6", type: "User" },
    }),
  ];
  await execute(0, state);
  assert.match(state.failures[0], /\(1\/2\)/);
});
