import { BoxRenderable, ScrollBoxRenderable, TextAttributes, TextRenderable } from "@opentui/core";
import type { CliRenderer, KeyEvent } from "@opentui/core";
import { groupPullRequests, singleLine, STATUS } from "./model";
import type { PullRequest } from "./model";

export const THEME = {
  background: "#10151d",
  selected: "#253247",
  text: "#e2e8f0",
  muted: "#94a3b8",
  repository: "#c4b5fd",
};

interface Actions {
  refresh: () => void;
  open: (pull: PullRequest) => void;
  copy: (pull: PullRequest) => void;
}

interface Row {
  pull: PullRequest;
  box: BoxRenderable;
  copied: TextRenderable;
  line: number;
}

export class PullRequestList {
  private readonly container: BoxRenderable;
  private readonly message: TextRenderable;
  private readonly scroll: ScrollBoxRenderable;
  private rows: Row[] = [];
  private selectedIndex = 0;
  private pendingReveal = false;
  private pressedRowId: number | undefined;
  private copiedId: number | undefined;
  private copyTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly renderer: CliRenderer, private readonly actions: Actions) {
    this.container = new BoxRenderable(renderer, {
      width: "100%", height: "100%", padding: 1,
      flexDirection: "column", backgroundColor: THEME.background,
    });
    this.message = new TextRenderable(renderer, {
      content: "加载中…", fg: THEME.muted, height: 1, flexShrink: 0,
      wrapMode: "none", truncate: true,
    });
    this.scroll = new ScrollBoxRenderable(renderer, {
      width: "100%", flexGrow: 1, minHeight: 0,
      scrollX: false, scrollY: true,
      contentOptions: { flexDirection: "column" },
      verticalScrollbarOptions: { visible: false },
      horizontalScrollbarOptions: { visible: false },
    });
    this.container.add(this.message);
    this.container.add(this.scroll);
    renderer.root.add(this.container);
    renderer.keyInput.on("keypress", this.onKey);
    renderer.on("frame", this.afterFrame);
    renderer.on("resize", this.onResize);
    renderer.once("destroy", () => {
      clearTimeout(this.copyTimer);
      renderer.keyInput.off("keypress", this.onKey);
      renderer.off("frame", this.afterFrame);
      renderer.off("resize", this.onResize);
    });
  }

  get selected(): PullRequest | undefined {
    return this.rows[this.selectedIndex]?.pull;
  }

  setPulls(pulls: PullRequest[]): void {
    const previous = this.selected?.id;
    const oldIndex = this.selectedIndex;
    for (const child of this.scroll.getChildren()) child.destroyRecursively();
    this.rows = [];
    this.pressedRowId = undefined;
    let line = 0;
    const groups = groupPullRequests(pulls);
    for (const [groupIndex, group] of groups.entries()) {
      if (groupIndex > 0) {
        this.scroll.add(new BoxRenderable(this.renderer, { height: 1, flexShrink: 0 }));
        line++;
      }
      this.scroll.add(new TextRenderable(this.renderer, {
        content: singleLine(group.repository), fg: THEME.repository,
        attributes: TextAttributes.BOLD, height: 1, flexShrink: 0,
        wrapMode: "none", truncate: true,
      }));
      line++;
      const numberWidth = Math.max(...group.pulls.map((pull) => String(pull.number).length)) + 1;
      const authorWidth = Math.min(24, Math.max(...group.pulls.map((pull) => pull.author.length + 1)));
      for (const pull of group.pulls) {
        const index = this.rows.length;
        const box = new BoxRenderable(this.renderer, {
          id: `pr-${pull.id}`, width: "100%", height: 1, flexShrink: 0,
          flexDirection: "row", paddingX: 1, gap: 1,
          onMouseDown: (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            this.pressedRowId = pull.id;
            this.select(index);
          },
          onMouseDrag: () => { this.pressedRowId = undefined; },
          onMouseUp: (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            if (this.pressedRowId === pull.id) this.actions.copy(pull);
            this.pressedRowId = undefined;
          },
        });
        const status = STATUS[pull.status];
        box.add(new TextRenderable(this.renderer, {
          content: `#${pull.number}`, fg: THEME.muted,
          width: numberWidth, height: 1, flexShrink: 0, wrapMode: "none",
        }));
        box.add(new TextRenderable(this.renderer, {
          content: singleLine(pull.title), fg: THEME.text,
          flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0,
          height: 1, wrapMode: "none", truncate: true,
        }));
        box.add(new TextRenderable(this.renderer, {
          content: `@${singleLine(pull.author)}`, fg: THEME.muted,
          width: authorWidth, maxWidth: "25%", minWidth: 0, flexShrink: 1, height: 1,
          wrapMode: "none", truncate: true,
        }));
        const copied = new TextRenderable(this.renderer, {
          content: "✓ 已复制", fg: STATUS.approved.color, attributes: TextAttributes.BOLD,
          width: 8, height: 1, flexShrink: 0, wrapMode: "none", visible: false,
        });
        box.add(copied);
        box.add(new TextRenderable(this.renderer, {
          content: status.label, fg: status.color, attributes: TextAttributes.BOLD,
          width: 6, height: 1, flexShrink: 0, wrapMode: "none",
        }));
        this.scroll.add(box);
        this.rows.push({ pull, box, copied, line: line++ });
      }
    }
    const retainedIndex = this.rows.findIndex((row) => row.pull.id === previous);
    this.selectedIndex = Math.max(0, Math.min(
      retainedIndex >= 0 ? retainedIndex : oldIndex,
      this.rows.length - 1,
    ));
    this.message.visible = this.rows.length === 0;
    this.message.fg = THEME.muted;
    this.message.content = "暂无 PR";
    this.paintSelection();
    this.paintCopyIndicator();
    this.pendingReveal = true;
    this.select(this.selectedIndex);
  }

  showError(error: unknown): void {
    this.message.content = singleLine(error instanceof Error ? error.message : String(error));
    this.message.fg = STATUS.changes.color;
    this.message.visible = true;
  }

  showCopied(pullId: number): void {
    clearTimeout(this.copyTimer);
    this.copiedId = pullId;
    this.paintCopyIndicator();
    this.copyTimer = setTimeout(() => {
      this.copiedId = undefined;
      this.paintCopyIndicator();
    }, 2_000);
  }

  private paintCopyIndicator(): void {
    const compact = this.renderer.width < 48;
    for (const row of this.rows) {
      row.copied.content = compact ? "✓" : "✓ 已复制";
      row.copied.width = compact ? 1 : 8;
      row.copied.visible = row.pull.id === this.copiedId;
    }
  }

  private paintSelection(): void {
    for (const [index, row] of this.rows.entries()) {
      row.box.backgroundColor = index === this.selectedIndex ? THEME.selected : "transparent";
    }
  }

  private onResize = (): void => {
    this.pendingReveal = true;
    this.paintCopyIndicator();
  };

  private afterFrame = (): void => {
    if (!this.pendingReveal) return;
    this.pendingReveal = false;
    // Scroll bounds are updated by layout. Reveal again after a refresh/resize.
    this.select(this.selectedIndex);
  };

  private select(index: number): void {
    if (this.rows.length === 0) return;
    this.selectedIndex = Math.max(0, Math.min(index, this.rows.length - 1));
    this.paintSelection();
    const row = this.rows[this.selectedIndex]!;
    const height = Math.max(1, this.scroll.viewport.height);
    if (row.line < this.scroll.scrollTop) this.scroll.scrollTo(Math.max(0, row.line - 1));
    else if (row.line >= this.scroll.scrollTop + height) this.scroll.scrollTo(row.line - height + 1);
  }

  private onKey = (key: KeyEvent): void => {
    if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) {
      this.renderer.destroy();
      return;
    }
    if (key.ctrl || key.meta) return;
    const page = Math.max(1, this.scroll.viewport.height - 1);
    switch (key.name) {
      case "j": case "down": this.select(this.selectedIndex + 1); break;
      case "k": case "up": this.select(this.selectedIndex - 1); break;
      case "pagedown": this.select(this.selectedIndex + page); break;
      case "pageup": this.select(this.selectedIndex - page); break;
      case "home": this.select(0); break;
      case "end": case "G": this.select(this.rows.length - 1); break;
      case "g": this.select(key.shift ? this.rows.length - 1 : 0); break;
      case "r": this.actions.refresh(); break;
      case "y": if (this.selected) this.actions.copy(this.selected); break;
      case "return": if (this.selected) this.actions.open(this.selected); break;
    }
  };
}
