# git_workflow

TypeScript + OpenTUI 的 GitHub Review 列表，复用本机 `gh` 登录。

```sh
npm install
npm start
```

项目内置 Bun 运行时，无需全局安装 Bun。需要可用的 GitHub CLI；尚未登录时运行 `gh auth login`。

安装到当前用户并自动配置 PATH：

```sh
npm run install:local
```

安装程序将独立可执行文件复制到 `~/.local/bin/git_workflow`，并将该目录写入 shell 启动配置（zsh 使用 `${ZDOTDIR:-$HOME}/.zshrc`）。首次修改前会保存 `.git_workflow.bak` 备份；重复安装会更新程序，且不会重复添加 PATH 条目。

重新打开终端，即可在任意目录运行：

```sh
git_workflow
```

当前 zsh 终端也可以执行 `source "${ZDOTDIR:-$HOME}/.zshrc"` 立即生效。

打包为当前系统和 CPU 架构的独立可执行程序：

```sh
npm run build
./dist/git_workflow
```

`dist/git_workflow` 内含 Bun 运行时和 OpenTUI 原生库，可以复制到同平台机器运行，无需安装 Node.js、Bun 或项目依赖。直接运行 `./git_workflow --install` 即可安装并配置 PATH。运行时仍需本机已登录的 `gh`。当前构建平台为 macOS Apple Silicon（arm64）。

按完整仓库名分组，同仓库内最近更新的 PR 在前。每行依次展示编号、标题、`@author` 和状态，状态在行末对齐。

| 状态 | 颜色 | 条件 |
| --- | --- | --- |
| `[等待]` | 蓝色 | 当前用户尚无有效的同意或修改决定 |
| `[同意]` | 绿色 | 当前用户最近的有效决定为 Approve |
| `[修改]` | 红色 | 当前用户最近的有效决定为 Request changes，HEAD 与该 Review 的 commit 相同 |
| `[提交]` | 黄色 | Request changes 后，HEAD 与该 Review 的 commit 不同 |

只展示未关闭、未合并、非 Draft 的 PR。合并“请求当前用户 Review”（包含所属团队的请求）和“当前用户已 Review”的搜索结果并去重，Review 状态变化不会移除 PR。状态只依据当前用户的 Review，普通评论和尚未提交的 Review 不覆盖已有决定；决定被撤销后显示等待。用 commit SHA 判断代码变化，避免把修改标题、标签或普通评论误判为新提交。

每 60 秒自动刷新，刷新失败时保留已有列表并显示一行错误。PR 搜索和 Review 记录均读取分页；搜索索引可能延迟，因此获取详情后再次过滤关闭、合并和 Draft。GitHub 每个搜索最多返回 1,000 条结果；超过上限或搜索结果不完整时会报错，不静默截断。

| 按键 | 操作 |
| --- | --- |
| `↑` / `↓` 或 `k` / `j` | 选择 PR |
| `PageUp` / `PageDown` | 翻页 |
| `Home` / `End` 或 `g` / `G` | 首条 / 末条 |
| `Enter` | 在浏览器打开选中的 PR |
| `y` | 复制选中 PR 的链接 |
| `r` | 刷新 |
| `q` / `Esc` / `Ctrl+C` | 退出 |

鼠标左键点击 PR 行即可选中并复制链接，支持滚轮。复制成功后，该行显示绿色 `✓ 已复制`，2 秒后自动消失；窄窗口仅显示 `✓`。复制使用系统剪贴板，远程终端通过 OSC 52 复制。快捷键、图例等说明只在此文档中提供。

```sh
npm run typecheck
npm test
```

测试覆盖当前用户 Review 的状态转换、查询合并去重、分页、详情过滤、错误处理，以及 OpenTUI 原生渲染器中的中文颜色、键盘选择、滚动和窗口缩放。

查询语义：[GitHub 搜索文档](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests#search-by-pull-request-review-status-and-reviewer)。渲染接口：[OpenTUI 文档](https://opentui.com/docs/)。
