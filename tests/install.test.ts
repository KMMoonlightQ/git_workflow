import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { access, chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installExecutable } from "../src/install";

test("installs, backs up shell config, and configures PATH once with correctly quoted paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "git_workflow-install-test-"));
  try {
    const source = join(root, "source");
    const binDirectory = join(root, "tools $PATH 'quoted' with spaces");
    const shellConfigFile = join(root, "shell config");
    const original = "# existing configuration\nexport GIT_WORKFLOW_TEST_VALUE=preserved";
    await writeFile(source, "#!/bin/sh\nprintf 'installed-v1\\n'\n", { mode: 0o755 });
    await writeFile(shellConfigFile, original);
    const result = await installExecutable(source, { binDirectory, shellConfigFile });
    expect((await stat(result.executablePath)).mode & 0o777).toBe(0o755);
    expect(await readFile(`${shellConfigFile}.git_workflow.bak`, "utf8")).toBe(original);
    const installedConfig = await readFile(shellConfigFile, "utf8");
    expect(installedConfig.startsWith(original)).toBe(true);

    await writeFile(source, "#!/bin/sh\nprintf 'installed-v2\\n'\n");
    await chmod(source, 0o755);
    await installExecutable(source, { binDirectory, shellConfigFile });
    await installExecutable(result.executablePath, { binDirectory, shellConfigFile });
    expect(await readFile(shellConfigFile, "utf8")).toBe(installedConfig);
    expect(await readFile(`${shellConfigFile}.git_workflow.bak`, "utf8")).toBe(original);

    const output = execFileSync("/bin/zsh", [
      "-f", "-c", 'source "$1"; source "$1"; print -r -- "$PATH"; print -r -- "$GIT_WORKFLOW_TEST_VALUE"; git_workflow',
      "git_workflow-install-test", shellConfigFile,
    ], { encoding: "utf8", cwd: root });
    const lines = output.trim().split("\n");
    expect(lines[0]?.split(":").filter((directory) => directory === binDirectory)).toHaveLength(1);
    expect(lines.slice(1)).toEqual(["preserved", "installed-v2"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("creates a missing shell config and rejects broken managed markers before installing", async () => {
  const root = await mkdtemp(join(tmpdir(), "git_workflow-install-test-"));
  try {
    const source = join(root, "source");
    const shellConfigFile = join(root, "config", ".zshrc");
    await writeFile(source, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await installExecutable(source, { binDirectory: join(root, "bin"), shellConfigFile });
    expect(await readFile(shellConfigFile, "utf8")).toContain("# >>> git_workflow >>>");
    const broken = "# >>> git_workflow >>>\nunfinished";
    await writeFile(shellConfigFile, broken);
    const untouchedBin = join(root, "not-installed");
    await expect(installExecutable(source, { binDirectory: untouchedBin, shellConfigFile })).rejects.toThrow("标记不完整");
    await expect(access(untouchedBin)).rejects.toThrow();
    expect(await readFile(shellConfigFile, "utf8")).toBe(broken);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migrates the old PATH block while preserving unrelated shell configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "git_workflow-migration-test-"));
  try {
    const source = join(root, "source");
    const shellConfigFile = join(root, ".zshrc");
    const before = "# user configuration\n";
    const after = "\n# other application\nexport GIT_WORKFLOW_TEST_VALUE=preserved\n";
    await writeFile(source, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await writeFile(shellConfigFile, before + "# >>> git-workflow >>>\n# old PATH block\n# <<< git-workflow <<<" + after);
    const options = { binDirectory: join(root, "bin"), shellConfigFile };
    const installed = await installExecutable(source, options);
    expect(installed.executablePath).toBe(join(root, "bin", "git_workflow"));
    const config = await readFile(shellConfigFile, "utf8");
    expect(config.startsWith(before)).toBe(true);
    expect(config.endsWith(after)).toBe(true);
    expect(config).not.toContain("git-workflow");
    expect(config.split("# >>> git_workflow >>>")).toHaveLength(2);
    await installExecutable(source, options);
    expect(await readFile(shellConfigFile, "utf8")).toBe(config);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
