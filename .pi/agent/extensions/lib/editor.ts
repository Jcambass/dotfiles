import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

export type EditorMode = "code" | "vim";

const VIM_QUIT_ALL_ABBREV = 'cnoreabbrev <expr> q getcmdtype() ==# ":" && getcmdline() ==# "q" ? "qa" : "q"';

function commandExists(command: string): boolean {
	try {
		execFileSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

export function codeCommand(): string {
	if (process.env.PI_CODE_COMMAND) return process.env.PI_CODE_COMMAND;
	if (commandExists("code-insiders")) return "code-insiders";
	return "code";
}

export function editorLabel(editor: EditorMode): string {
	return editor === "vim" ? "Vim" : "VS Code Insiders";
}

export function vimArgs(...args: string[]): string[] {
	// Keep Vim-launched-from-Pi sessions easy to exit, including accidental splits.
	return ["-c", VIM_QUIT_ALL_ABBREV, ...args];
}

export function absoluteFrom(cwd: string, filePath: string, root = cwd): string {
	if (path.isAbsolute(filePath)) return filePath;

	const cwdPath = path.resolve(cwd, filePath);
	if (existsSync(cwdPath)) return cwdPath;

	return path.resolve(root, filePath);
}

export async function projectRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
	const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5000 });
	if (result.code === 0 && result.stdout.trim()) return result.stdout.trim();
	return cwd;
}

export async function openCodeProjectFiles(pi: ExtensionAPI, cwd: string, files: string[]): Promise<void> {
	const command = codeCommand();
	const root = await projectRoot(pi, cwd);
	const absoluteFiles = files.map((file) => absoluteFrom(cwd, file, root));
	const result = await pi.exec(command, ["--reuse-window", root, ...absoluteFiles], { cwd: root });
	if (result.code !== 0) throw new Error(`${command} exited ${result.code}`);
}

export async function openCodeDiffs(pi: ExtensionAPI, cwd: string, diffs: Array<{ before: string; after: string }>): Promise<void> {
	const command = codeCommand();
	const root = await projectRoot(pi, cwd);
	const openRoot = await pi.exec(command, ["--reuse-window", root], { cwd: root });
	if (openRoot.code !== 0) throw new Error(`${command} exited ${openRoot.code}`);

	for (const diff of diffs) {
		const result = await pi.exec(command, ["--reuse-window", "--diff", diff.before, absoluteFrom(cwd, diff.after, root)], { cwd: root });
		if (result.code !== 0) throw new Error(`${command} exited ${result.code}`);
	}
}
