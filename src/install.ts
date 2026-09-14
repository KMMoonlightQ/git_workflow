import { constants } from "node:fs";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const startMarker = "# >>> git_workflow >>>";
const endMarker = "# <<< git_workflow <<<";

interface InstallOptions {
  binDirectory?: string;
  shellConfigFile?: string;
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function defaultShellConfig(): string {
  switch (basename(process.env.SHELL || "/bin/zsh")) {
    case "zsh": return join(process.env.ZDOTDIR || homedir(), ".zshrc");
    case "bash": return join(homedir(), process.platform === "darwin" ? ".bash_profile" : ".bashrc");
    case "sh": return join(homedir(), ".profile");
    default: throw new Error("自动配置 PATH 目前支持 zsh、bash 和 sh");
  }
}

export async function installExecutable(source: string, options: InstallOptions = {}) {
  const binDirectory = options.binDirectory ?? join(homedir(), ".local", "bin");
  const shellConfigFile = options.shellConfigFile ?? defaultShellConfig();
  const executablePath = join(binDirectory, "git_workflow");
  await access(source, constants.R_OK | constants.X_OK);

  let existing = "";
  let configExists = true;
  try {
    existing = await readFile(shellConfigFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    configExists = false;
  }
  const block = [
    startMarker,
    'case ":$PATH:" in',
    `  *${quoteShell(`:${binDirectory}:`)}*) ;;`,
    `  *) export PATH=${quoteShell(binDirectory)}:"$PATH" ;;`,
    "esac",
    endMarker,
  ].join("\n");
  // Reuse the previous installer's PATH block when upgrading the command name.
  const currentMarkers = existing.includes(startMarker) || existing.includes(endMarker);
  const previousStartMarker = currentMarkers ? startMarker : "# >>> git-workflow >>>";
  const previousEndMarker = currentMarkers ? endMarker : "# <<< git-workflow <<<";
  const start = existing.indexOf(previousStartMarker);
  const end = existing.indexOf(previousEndMarker);
  if ((start >= 0) !== (end >= 0) || (start >= 0 && end < start)) {
    throw new Error(`PATH 配置标记不完整：${shellConfigFile}`);
  }
  const updated = start >= 0
    ? existing.slice(0, start) + block + existing.slice(end + previousEndMarker.length)
    : existing + (existing.endsWith("\n") || !existing ? "" : "\n") + "\n" + block + "\n";

  await mkdir(binDirectory, { recursive: true });
  // Replace by rename so reinstalling is safe even while the old binary runs.
  const temporary = await mkdtemp(join(binDirectory, ".git_workflow-install-"));
  try {
    const staged = join(temporary, "git_workflow");
    await copyFile(source, staged);
    await chmod(staged, 0o755);
    await rename(staged, executablePath);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  if (updated !== existing) {
    await mkdir(dirname(shellConfigFile), { recursive: true });
    if (configExists) {
      try {
        await copyFile(shellConfigFile, `${shellConfigFile}.git_workflow.bak`, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    await writeFile(shellConfigFile, updated, { mode: 0o600 });
  }
  return { executablePath, shellConfigFile };
}
