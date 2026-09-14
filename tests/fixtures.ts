import type { PullRequest, Review } from "../src/model";

export const review = (overrides: Partial<Review> = {}): Review => ({
  id: 1,
  user: { login: "alice" },
  state: "CHANGES_REQUESTED",
  submitted_at: "2026-09-14T01:00:00Z",
  commit_id: "head-sha",
  ...overrides,
});

export const pull = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  id: 1,
  number: 42,
  title: "修复登录重试",
  author: "octocat",
  url: "https://github.com/acme/api/pull/42",
  repository: "acme/api",
  updatedAt: "2026-09-14T01:00:00Z",
  status: "waiting",
  ...overrides,
});
