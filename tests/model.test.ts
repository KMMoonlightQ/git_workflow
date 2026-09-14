import { describe, expect, test } from "bun:test";
import { groupPullRequests, reviewStatus, singleLine } from "../src/model";
import { pull, review } from "./fixtures";

describe("current user's review status", () => {
  test("no review, another user's review, comments, and pending reviews wait", () => {
    expect(reviewStatus([], "alice", "head-sha")).toBe("waiting");
    expect(reviewStatus([
      review({ state: "APPROVED", user: { login: "bob" } }),
      review({ state: "COMMENTED" }),
      review({ state: "PENDING", submitted_at: null }),
      review({ state: "APPROVED", user: null }),
    ], "alice", "head-sha")).toBe("waiting");
  });

  test("approval stays approved after a new commit", () => {
    expect(reviewStatus([review({ state: "APPROVED" })], "ALICE", "new-sha")).toBe("approved");
  });

  test("changes requested becomes submitted when the head differs from the reviewed commit", () => {
    expect(reviewStatus([review()], "alice", "head-sha")).toBe("changes");
    expect(reviewStatus([review()], "alice", "new-sha")).toBe("updated");
    expect(reviewStatus([review({ commit_id: null })], "alice", "new-sha")).toBe("changes");
  });

  test("the latest decision wins even when reviews arrive out of order", () => {
    const earlier = review();
    const approval = review({ id: 2, state: "APPROVED", submitted_at: "2026-09-14T02:00:00Z" });
    expect(reviewStatus([approval, earlier], "alice", "new-sha")).toBe("approved");
    const rejection = review({ id: 3, submitted_at: "2026-09-14T03:00:00Z", commit_id: "new-sha" });
    expect(reviewStatus([rejection, approval, earlier], "alice", "new-sha")).toBe("changes");
  });

  test("later comments and drafts do not erase a decision", () => {
    const later = { id: 2, submitted_at: "2026-09-14T02:00:00Z" };
    expect(reviewStatus([
      review(), review({ ...later, state: "COMMENTED" }),
      review({ id: 3, state: "PENDING", submitted_at: null }),
    ], "alice", "head-sha")).toBe("changes");
  });

  test("a dismissed decision waits, without reviving an older decision", () => {
    expect(reviewStatus([
      review({ state: "APPROVED" }),
      review({ id: 2, state: "DISMISSED", submitted_at: "2026-09-14T02:00:00Z" }),
    ], "alice", "head-sha")).toBe("waiting");
  });

  test("review ID breaks equal timestamp ties", () => {
    expect(reviewStatus([review({ id: 2, state: "APPROVED" }), review()], "alice", "head-sha"))
      .toBe("approved");
  });
});

test("groups by full repo name, deduplicates and orders recent PRs first", () => {
  const a = pull();
  const b = pull({ id: 2, repository: "other/api" });
  const c = pull({ id: 3, updatedAt: "2026-09-14T03:00:00Z" });
  const groups = groupPullRequests([b, a, c, a]);
  expect(groups.map((group) => group.repository)).toEqual(["acme/api", "other/api"]);
  expect(groups[0]?.pulls.map((item) => item.id)).toEqual([3, 1]);
});

test("titles remain on one terminal line", () => {
  expect(singleLine("修复\n标题\t\u001b[31m\u0007")).toBe("修复 标题  [31m ");
});
