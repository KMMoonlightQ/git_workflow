import { expect, test } from "bun:test";
import { createClipboard, RGBA } from "@opentui/core";
import { createTestRenderer, MouseButtons } from "@opentui/core/testing";
import { STATUS } from "../src/model";
import type { ReviewStatus } from "../src/model";
import { PullRequestList } from "../src/ui";
import { pull } from "./fixtures";

test("renders only repositories, PRs, and correctly colored Chinese status labels", async () => {
  const setup = await createTestRenderer({ width: 76, height: 14 });
  try {
    const list = new PullRequestList(setup.renderer, { refresh() {}, open() {}, copy() {} });
    const states: ReviewStatus[] = ["waiting", "approved", "changes", "updated"];
    list.setPulls(states.map((status, id) => pull({
      id, number: id + 1, status, repository: id < 2 ? "acme/api" : "acme/web",
    })));
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("acme/api");
    expect(frame).toContain("acme/web");
    expect(frame).toContain("修复登录重试");
    expect(frame).toContain("@octocat");
    for (const line of frame.split("\n").filter((line) => line.includes("@octocat"))) {
      expect(line.trim()).toMatch(/^#\d+\s+修复登录重试\s+@octocat\s+\[(等待|同意|修改|提交)\]$/);
    }
    expect(frame).not.toMatch(/加载|暂无|刷新|退出|按键|Review|状态/);
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    for (const status of Object.values(STATUS)) {
      expect(frame).toContain(status.label);
      const span = spans.find((span) => span.text.includes(status.label));
      expect(span?.fg.equals(RGBA.fromHex(status.color))).toBe(true);
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("keyboard scrolls, opens the selected PR, refreshes, and preserves selection through updates", async () => {
  const setup = await createTestRenderer({ width: 52, height: 8 });
  let opened: number | undefined;
  let refreshes = 0;
  try {
    const list = new PullRequestList(setup.renderer, {
      refresh: () => { refreshes++; },
      open: (pull) => { opened = pull.id; },
      copy() {},
    });
    const pulls = Array.from({ length: 30 }, (_, index) => pull({ id: index, number: index + 1, title: `Title ${index}` }));
    list.setPulls(pulls);
    await setup.renderOnce();
    setup.mockInput.pressKey("G");
    await setup.renderOnce();
    expect(list.selected?.id).toBe(0);
    expect(setup.captureCharFrame()).toContain("Title 0");
    setup.mockInput.pressArrow("up");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("r");
    expect(opened).toBe(1);
    expect(refreshes).toBe(1);
    list.setPulls(pulls.map((pull) => ({ ...pull, status: "approved", updatedAt: pull.id === 1 ? "2026-09-15T00:00:00Z" : pull.updatedAt })));
    await setup.renderOnce();
    expect(list.selected?.id).toBe(1);
    expect(list.selected?.status).toBe("approved");
    expect(setup.captureCharFrame()).toContain("Title 1");
    setup.mockInput.pressKey("g");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("acme/api");
  } finally {
    setup.renderer.destroy();
  }
});

test("narrow resize keeps statuses on one line; error recovery clears stale rows", async () => {
  const setup = await createTestRenderer({ width: 70, height: 9 });
  try {
    const list = new PullRequestList(setup.renderer, { refresh() {}, open() {}, copy() {} });
    list.setPulls([pull({ title: "中文标题非常长 👩‍💻 with emoji and more text" })]);
    await setup.renderOnce();
    setup.resize(24, 9);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("[等待]");
    list.showError(new Error("网络错误"));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("网络错误");
    expect(setup.captureCharFrame()).toContain("[等待]");
    list.setPulls([]);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("暂无 PR");
    expect(setup.captureCharFrame()).not.toContain("acme/api");
    expect(setup.captureCharFrame()).not.toContain("网络错误");
    setup.mockInput.pressKey("q");
  } finally {
    setup.renderer.destroy();
  }
});

test("left click copies the clicked PR link; right click, drag, and repo headings do not copy", async () => {
  const setup = await createTestRenderer({ width: 76, height: 12 });
  const copied: string[] = [];
  const clipboard = createClipboard({
    host: {
      maxWriteBytes: 1024,
      async writeText(text) { copied.push(text); return { status: "written" }; },
      async read() { return { status: "empty" }; },
      async clear() { return { status: "cleared" }; },
      async dispose() {},
    },
    terminal: {
      remote: false,
      writeText() { throw new Error("The native host should handle local clipboard writes"); },
      clear() { throw new Error("Unexpected clipboard clear"); },
    },
  });
  let pending = Promise.resolve();
  try {
    const list = new PullRequestList(setup.renderer, {
      refresh() {}, open() { throw new Error("Click must copy, not open"); },
      copy: (pull) => {
        pending = clipboard.writeText(pull.url, { destination: "best-available" }).then(() => {});
      },
    });
    const first = pull({ id: 1, number: 1, url: "https://github.com/acme/api/pull/1" });
    const second = pull({ id: 2, number: 2, url: "https://github.com/acme/api/pull/2" });
    list.setPulls([first, second]);
    await setup.renderOnce();
    const row = setup.renderer.root.findDescendantById("pr-1")!;
    const x = row.x + 8;
    const y = row.y;
    await setup.mockMouse.click(x, y);
    await pending;
    expect(list.selected?.id).toBe(first.id);
    expect(copied).toEqual([first.url]);
    await setup.mockMouse.click(x, y, MouseButtons.RIGHT);
    await setup.mockMouse.drag(x, y, x + 6, y);
    await setup.mockMouse.click(3, 1);
    expect(copied).toEqual([first.url]);
    setup.mockInput.pressArrow("up");
    setup.mockInput.pressKey("y");
    await pending;
    expect(copied).toEqual([first.url, second.url]);
  } finally {
    await clipboard.dispose();
    setup.renderer.destroy();
  }
});

test("clicks with small pointer motion still copy once and show confirmation across the PR row", async () => {
  const setup = await createTestRenderer({ width: 76, height: 12 });
  const copied: string[] = [];
  try {
    const list = new PullRequestList(setup.renderer, {
      refresh() {}, open() {},
      copy: (pull) => { copied.push(pull.url); list.showCopied(pull.id); },
    });
    const clicked = pull();
    list.setPulls([clicked]);
    await setup.renderOnce();
    const row = setup.renderer.root.findDescendantById(`pr-${clicked.id}`)!;
    // Exercise padding and each text column, which have different hit targets.
    let clicks = 0;
    for (const motion of [0, 1]) {
      for (const column of [-1, 0, 1, 2, 4]) {
        const x = column < 0 ? row.x : row.getChildren()[column]!.x + 1;
        const y = row.y;
        await setup.mockMouse.pressDown(x, y);
        await setup.renderOnce();
        // A terminal can report held-button motion even within the same cell.
        setup.renderer.stdin.emit("data", Buffer.from(`\x1b[<32;${x + 1};${y + 1}M`));
        setup.renderer.stdin.emit("data", Buffer.from(`\x1b[<32;${x + motion + 1};${y + 1}M`));
        await setup.mockMouse.release(x + motion, y);
        await setup.renderOnce();
        expect(copied).toEqual(Array(++clicks).fill(clicked.url));
        expect(setup.captureCharFrame()).toContain("✓ 已复制");
      }
    }
  } finally {
    setup.renderer.destroy();
  }
});

test("dragging away and back, releasing on another row, and refreshing mid-click do not copy", async () => {
  const setup = await createTestRenderer({ width: 76, height: 12 });
  const copied: string[] = [];
  try {
    const list = new PullRequestList(setup.renderer, {
      refresh() {}, open() {}, copy: (pull) => { copied.push(pull.url); },
    });
    const pulls = [pull(), pull({ id: 2, number: 43 })];
    list.setPulls(pulls);
    await setup.renderOnce();
    const row = setup.renderer.root.findDescendantById("pr-1")!;
    const x = row.x + 8;
    const y = row.y;
    await setup.mockMouse.pressDown(x, y);
    await setup.mockMouse.moveTo(x + 6, y);
    await setup.mockMouse.moveTo(x, y);
    await setup.mockMouse.release(x, y);
    await setup.mockMouse.pressDown(x, y);
    await setup.mockMouse.release(x, y - 1);
    await setup.mockMouse.pressDown(x, y);
    list.setPulls(pulls);
    await setup.renderOnce();
    await setup.mockMouse.release(x, y);
    expect(copied).toEqual([]);
  } finally {
    setup.renderer.destroy();
  }
});
