export type ReviewStatus = "waiting" | "approved" | "changes" | "updated";

export const STATUS = {
  waiting: { label: "[等待]", color: "#60a5fa" },
  approved: { label: "[同意]", color: "#4ade80" },
  changes: { label: "[修改]", color: "#f87171" },
  updated: { label: "[提交]", color: "#facc15" },
} as const;

export interface Review {
  id: number;
  user: { login: string } | null;
  state: string;
  submitted_at: string | null;
  commit_id: string | null;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  author: string;
  url: string;
  repository: string;
  updatedAt: string;
  status: ReviewStatus;
}

export interface RepositoryGroup {
  repository: string;
  pulls: PullRequest[];
}

export function reviewStatus(reviews: Review[], login: string, headSha: string): ReviewStatus {
  // Comments and pending reviews do not replace an earlier approval/change request.
  const decisions = reviews
    .filter((review) =>
      review.user?.login.toLowerCase() === login.toLowerCase() &&
      review.submitted_at !== null &&
      ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state),
    )
    .sort((a, b) => Date.parse(b.submitted_at!) - Date.parse(a.submitted_at!) || b.id - a.id);

  const latest = decisions[0];
  if (latest?.state === "APPROVED") return "approved";
  if (latest?.state === "CHANGES_REQUESTED") {
    return latest.commit_id && latest.commit_id !== headSha ? "updated" : "changes";
  }
  return "waiting";
}

export function groupPullRequests(pulls: PullRequest[]): RepositoryGroup[] {
  const groups = new Map<string, PullRequest[]>();
  for (const pull of new Map(pulls.map((pull) => [pull.id, pull])).values()) {
    const group = groups.get(pull.repository) ?? [];
    group.push(pull);
    groups.set(pull.repository, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repository, pulls]) => ({
      repository,
      pulls: pulls.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.number - a.number),
    }));
}

export function singleLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
}
