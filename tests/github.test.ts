import { expect, test } from "bun:test";
import { GitHubClient } from "../src/github";
import type { GhRunner } from "../src/github";
import { review } from "./fixtures";

function item(number: number) {
  return {
    number, repository_url: "https://api.github.com/repos/acme/api",
    pull_request: { url: `https://api.github.com/repos/acme/api/pulls/${number}` },
  };
}

function detail(number: number, extra = {}) {
  return {
    id: number, number, title: `PR ${number}`,
    user: { login: "octocat" },
    html_url: `https://github.com/acme/api/pull/${number}`,
    state: "open", draft: false, merged: false, merged_at: null,
    updated_at: "2026-09-14T01:00:00Z", head: { sha: "head-sha" },
    base: { repo: { full_name: "acme/api" } }, ...extra,
  };
}

test("unions requested and reviewed PRs, paginates searches and reviews, and filters fresh details", async () => {
  const calls: string[][] = [];
  const run: GhRunner = async (args) => {
    calls.push(args);
    if (args[1] === "user") return JSON.stringify({ login: "alice" });
    if (args[1] === "search/issues") {
      expect(args).toContain("GET");
      expect(args.find((arg) => arg.startsWith("q="))).toContain("is:open draft:false");
      if (args.some((arg) => arg.includes("reviewed-by:alice"))) {
        return JSON.stringify({ total_count: 2, incomplete_results: false, items: [item(1), item(6)] });
      }
      return JSON.stringify({
        total_count: 5, incomplete_results: false,
        items: args.includes("page=1") ? [item(1), item(2)] : [item(3), item(4), item(5)],
      });
    }
    const number = Number(args[1]!.match(/pulls\/(\d+)/)?.[1]);
    if (args[1]?.includes("/reviews?")) {
      expect(args).toContain("--paginate");
      expect(args).toContain("--slurp");
      return JSON.stringify([
        Array.from({ length: 100 }, (_, id) => review({ id, user: { login: "bob" } })),
        [review({ state: number === 6 ? "APPROVED" : "CHANGES_REQUESTED" })],
      ]);
    }
    const extra = {
      2: { draft: true },
      3: { state: "closed" },
      4: { merged: true },
      5: { merged_at: "2026-09-14T02:00:00Z" },
    }[number];
    return JSON.stringify(detail(number, extra));
  };
  const pulls = await new GitHubClient(run).load();
  expect(pulls.sort((a, b) => a.id - b.id).map(({ id, status }) => ({ id, status })))
    .toEqual([{ id: 1, status: "changes" }, { id: 6, status: "approved" }]);
  expect(calls.filter((args) => args[1] === "repos/acme/api/pulls/1")).toHaveLength(1);
  expect(calls.filter((args) => args[1]?.includes("/reviews?"))).toHaveLength(2);
  expect(pulls.map((pull) => pull.author)).toEqual(["octocat", "octocat"]);
});

test("retains the same PR through every review transition even after its request disappears", async () => {
  let phase = 0;
  const run: GhRunner = async (args) => {
    if (args[1] === "user") return JSON.stringify({ login: "alice" });
    if (args[1] === "search/issues") {
      const requested = args.some((arg) => arg.includes("review-requested:"));
      const items = (phase === 0) === requested ? [item(1)] : [];
      return JSON.stringify({ total_count: items.length, incomplete_results: false, items });
    }
    if (args[1]?.includes("/reviews?")) {
      return JSON.stringify([phase === 0 ? [] : [review({ state: phase <= 2 ? "APPROVED" : "CHANGES_REQUESTED" })]]);
    }
    return JSON.stringify(detail(1, phase === 2 || phase === 4 ? { head: { sha: "new-sha" } } : {}));
  };
  const client = new GitHubClient(run);
  for (const expected of ["waiting", "approved", "updated", "changes", "updated"] as const) {
    const pulls = await client.load();
    expect(pulls).toHaveLength(1);
    expect(pulls[0]?.status).toBe(expected);
    phase++;
  }
});

test("does not silently present incomplete search results", async () => {
  for (const response of [
    { total_count: 1, incomplete_results: true, items: [] },
    { total_count: 1001, incomplete_results: false, items: [] },
  ]) {
    const client = new GitHubClient(async (args) => JSON.stringify(args[1] === "user" ? { login: "alice" } : response));
    await expect(client.load()).rejects.toThrow(response.incomplete_results ? "不完整" : "1000");
  }
});

test("failed review fetch is an error, never a false waiting status", async () => {
  const client = new GitHubClient(async (args) => {
    if (args[1] === "user") return JSON.stringify({ login: "alice" });
    if (args[1] === "search/issues") return JSON.stringify({ total_count: 1, incomplete_results: false, items: [item(1)] });
    if (args[1]?.includes("/reviews?")) throw new Error("HTTP 403");
    return JSON.stringify(detail(1));
  });
  await expect(client.load()).rejects.toThrow("HTTP 403");
});

test("rejects invalid JSON and respects cancellation", async () => {
  await expect(new GitHubClient(async () => "invalid").load()).rejects.toThrow("JSON");
  const abort = new AbortController();
  abort.abort();
  const client = new GitHubClient(async () => JSON.stringify({ login: "alice" }));
  await expect(client.load(abort.signal)).rejects.toThrow();
});
