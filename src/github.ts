import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { reviewStatus } from "./model";
import type { PullRequest, Review } from "./model";

const execFileAsync = promisify(execFile);
export type GhRunner = (args: string[], signal?: AbortSignal) => Promise<string>;

export const runGh: GhRunner = async (args, signal) => {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
      signal,
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
    });
    return stdout;
  } catch (error) {
    if (signal?.aborted) throw error;
    const failure = error as { code?: string; stderr?: string; killed?: boolean };
    if (failure.code === "ENOENT") throw new Error("未找到 gh，请先安装 GitHub CLI");
    if (failure.killed) throw new Error("GitHub 请求超时");
    const message = failure.stderr?.trim() || (error as Error).message;
    if (/authentication|gh auth login|HTTP 401|Bad credentials/i.test(message)) {
      throw new Error("gh 未登录或凭据失效，请运行 gh auth login");
    }
    throw new Error(message);
  }
};

interface SearchItem {
  number: number;
  repository_url: string;
  pull_request?: { url: string };
}

interface SearchPage {
  total_count: number;
  incomplete_results: boolean;
  items: SearchItem[];
}

interface PullDetail {
  id: number;
  number: number;
  title: string;
  user: { login: string } | null;
  html_url: string;
  draft: boolean;
  state: "open" | "closed";
  merged: boolean;
  merged_at: string | null;
  updated_at: string;
  head: { sha: string };
  base: { repo: { full_name: string } };
}

export class GitHubClient {
  constructor(private readonly run: GhRunner = runGh) {}

  private async json<T>(args: string[], signal?: AbortSignal): Promise<T> {
    const output = await this.run(args, signal);
    try {
      return JSON.parse(output) as T;
    } catch {
      throw new Error("gh 返回了无效的 JSON");
    }
  }

  private async search(qualifier: string, signal?: AbortSignal): Promise<SearchItem[]> {
    const items: SearchItem[] = [];
    for (let page = 1; ; page++) {
      signal?.throwIfAborted();
      const response = await this.json<SearchPage>([
        "api", "search/issues", "--method", "GET",
        "-f", `q=is:pr is:open draft:false ${qualifier}`,
        "-f", "sort=updated", "-f", "order=desc",
        "-f", "per_page=100", "-f", `page=${page}`,
      ], signal);
      if (response.incomplete_results) throw new Error("GitHub 搜索结果不完整，请重试");
      if (response.total_count > 1000) throw new Error("PR 数量超过 GitHub 搜索上限（1000）");
      items.push(...response.items);
      if (items.length >= response.total_count || response.items.length === 0) return items;
    }
  }

  async load(signal?: AbortSignal): Promise<PullRequest[]> {
    const viewer = await this.json<{ login: string }>(["api", "user"], signal);
    // GitHub removes a fulfilled review request. Retain reviewed PRs independently,
    // regardless of the current review verdict.
    const results = await Promise.allSettled([
      this.search(`review-requested:${viewer.login}`, signal),
      this.search(`reviewed-by:${viewer.login}`, signal),
    ]);
    const candidates = new Map<string, SearchItem>();
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      for (const item of result.value) {
        if (item.pull_request) candidates.set(item.pull_request.url, item);
      }
    }

    const queue = [...candidates.values()];
    const pulls: PullRequest[] = [];
    let next = 0;
    let failed = false;
    const workers = await Promise.allSettled(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (next < queue.length && !failed) {
        signal?.throwIfAborted();
        const item = queue[next++]!;
        try {
          const repository = new URL(item.repository_url).pathname.match(/\/repos\/([^/]+\/[^/]+)$/)?.[1];
          if (!repository) throw new Error("GitHub 返回了无效的仓库地址");
          const endpoint = `repos/${repository}/pulls/${item.number}`;
          const detail = await this.json<PullDetail>(["api", endpoint], signal);
          // Search indexing can lag behind a merge or a conversion to draft.
          if (detail.state !== "open" || detail.draft || detail.merged || detail.merged_at) continue;
          const pages = await this.json<Review[][]>([
            "api", `${endpoint}/reviews?per_page=100`, "--paginate", "--slurp",
          ], signal);
          pulls.push({
            id: detail.id,
            number: detail.number,
            title: detail.title,
            author: detail.user?.login ?? "ghost",
            url: detail.html_url,
            repository: detail.base.repo.full_name,
            updatedAt: detail.updated_at,
            status: reviewStatus(pages.flat(), viewer.login, detail.head.sha),
          });
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }));
    for (const worker of workers) {
      if (worker.status === "rejected") throw worker.reason;
    }
    return pulls;
  }

  async open(pull: PullRequest, signal?: AbortSignal): Promise<void> {
    await this.run(["pr", "view", pull.url, "--web"], signal);
  }
}
