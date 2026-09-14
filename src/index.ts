import { createClipboard, createCliRenderer, createHostClipboard, createRendererClipboardAdapter } from "@opentui/core";
import { GitHubClient } from "./github";
import { PullRequestList, THEME } from "./ui";
import { singleLine } from "./model";
import { installExecutable } from "./install";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  if (process.argv.includes("--install")) {
    const source = import.meta.url.includes("/$bunfs/")
      ? process.execPath
      : fileURLToPath(new URL("../dist/git-workflow", import.meta.url));
    const result = await installExecutable(source);
    process.stdout.write(`已安装：${result.executablePath}\nPATH 已配置：${result.shellConfigFile}\n重新打开终端后，运行 git-workflow\n`);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("请在交互式终端中运行此程序");
  }
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: THEME.background,
    consoleMode: "disabled",
  });
  renderer.setTerminalTitle("git-workflow");
  const abort = new AbortController();
  const github = new GitHubClient();
  const clipboard = createClipboard({
    host: createHostClipboard(),
    terminal: createRendererClipboardAdapter(renderer),
  });
  let loading = false;
  let opening = false;
  const list = new PullRequestList(renderer, {
    refresh: () => void refresh(),
    copy: async (pull) => {
      try {
        const result = await clipboard.writeText(pull.url, {
          destination: "best-available", signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        if (result.host.status === "written" || result.terminal.status === "attempted") {
          list.showCopied(pull.id);
        } else {
          list.showError(new Error("复制链接失败"));
        }
      } catch (error) {
        if (!abort.signal.aborted) list.showError(error);
      }
    },
    open: async (pull) => {
      if (opening) return;
      opening = true;
      try {
        await github.open(pull, abort.signal);
      } catch (error) {
        if (!abort.signal.aborted) list.showError(error);
      } finally {
        opening = false;
      }
    },
  });

  async function refresh(): Promise<void> {
    if (loading || abort.signal.aborted) return;
    loading = true;
    try {
      const pulls = await github.load(abort.signal);
      if (!abort.signal.aborted) list.setPulls(pulls);
    } catch (error) {
      if (!abort.signal.aborted) list.showError(error);
    } finally {
      loading = false;
    }
  }

  const timer = setInterval(() => void refresh(), 60_000);
  const destroyed = new Promise<void>((resolve) => renderer.once("destroy", resolve));
  const shutdown = () => renderer.destroy();
  process.once("SIGTERM", shutdown);
  renderer.once("destroy", () => {
    clearInterval(timer);
    abort.abort();
    process.off("SIGTERM", shutdown);
  });
  try {
    await refresh();
    await destroyed;
  } finally {
    try {
      await clipboard.dispose();
    } finally {
      renderer.destroy();
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${singleLine(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
});
