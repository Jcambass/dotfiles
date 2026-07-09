/**
 * Diff Extension
 *
 * /diff — interactive picker for git-changed files, opens diffs in VS Code Insiders.
 *   - Enter: open selected file's diff
 *   - a: open all diffs
 *   - Esc: close
 *
 * /diff vim — use Vim/vimdiff instead, with Pi's TUI suspended while Vim runs.
 * /diff all — open all changed files directly (no picker).
 * /diff all vim — open all changed files in Vim diff mode.
 *
 * Temp files (HEAD versions for diff tools) use a per-process directory
 * that's cleaned up on process exit and at the start of each invocation.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { editorLabel, openCodeDiffs, openCodeProjectFiles, type EditorMode, vimArgs } from "./lib/editor.js";

// ── Temp file management ────────────────────────────────────────────

const DIFF_TMP_DIR = path.join(os.tmpdir(), `pi-diff-${process.pid}`);

function cleanTmpDir(): void {
	try { rmSync(DIFF_TMP_DIR, { recursive: true, force: true }); } catch {}
}

function ensureTmpDir(): void {
	cleanTmpDir();
	mkdirSync(DIFF_TMP_DIR, { recursive: true });
}

// Clean up on process exit
process.on("exit", cleanTmpDir);

function writeTmpFile(name: string, content: string): string {
	const safeName = name.replace(/[/\\]/g, "-");
	const tmpPath = path.join(DIFF_TMP_DIR, `${Date.now()}-${safeName}`);
	writeFileSync(tmpPath, content, "utf-8");
	return tmpPath;
}

// ── Types ───────────────────────────────────────────────────────────

interface FileInfo {
	status: string;
	file: string;
}

interface DiffArgs {
	all: boolean;
	editor: EditorMode;
}

// ── Helpers ─────────────────────────────────────────────────────────

function parseDiffArgs(args: string | undefined): DiffArgs {
	const tokens = args?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
	return {
		all: tokens.includes("all"),
		editor: tokens.some((t) => t === "vim" || t === "vi" || t === "nvim") ? "vim" : "code",
	};
}

function commandExists(command: string): boolean {
	try {
		execFileSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

// ── Extension ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

	async function getChangedFiles(cwd: string): Promise<FileInfo[] | null> {
		const result = await pi.exec("git", ["status", "--porcelain"], { cwd });
		if (result.code !== 0) return null;
		if (!result.stdout?.trim()) return [];

		const files: FileInfo[] = [];
		for (const line of result.stdout.split("\n")) {
			if (line.length < 4) continue;
			const statusCode = line.slice(0, 2);
			const file = line.slice(2).trimStart();

			let status: string;
			if (statusCode.includes("M")) status = "M";
			else if (statusCode.includes("A")) status = "A";
			else if (statusCode.includes("D")) status = "D";
			else if (statusCode.includes("?")) status = "?";
			else if (statusCode.includes("R")) status = "R";
			else if (statusCode.includes("C")) status = "C";
			else status = statusCode.trim() || "~";

			files.push({ status, file });
		}
		return files;
	}

	function getHeadContent(file: string, cwd: string): string {
		try {
			return execFileSync("git", ["show", `HEAD:${file}`], { cwd, encoding: "utf-8", timeout: 5000 });
		} catch {
			return "";
		}
	}

	pi.registerCommand("diff", {
		description: "Show git changes and open diffs in VS Code Insiders or Vim (/diff [all] [vim])",
		handler: async (args, ctx) => {
			const parsed = parseDiffArgs(args);
			const files = await getChangedFiles(ctx.cwd);
			if (files === null) {
				ctx.ui.notify("git status failed", "error");
				return;
			}
			if (files.length === 0) {
				ctx.ui.notify("No changes in working tree", "info");
				return;
			}

			if (parsed.editor === "vim" && ctx.mode !== "tui") {
				ctx.ui.notify("Vim diff mode requires Pi TUI", "error");
				return;
			}

			const runTerminal = async (command: string, commandArgs: string[]): Promise<number> => {
				const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
					// Stop Pi's TUI so Vim owns the terminal while it is running.
					tui.stop();
					process.stdout.write("\x1b[2J\x1b[H");

					const result = spawnSync(command, commandArgs, {
						cwd: ctx.cwd,
						stdio: "inherit",
						env: process.env,
					});

					// Restart and force a full redraw after Vim exits.
					tui.start();
					tui.requestRender(true);
					done(result.status ?? 1);

					return { render: () => [], invalidate: () => {} };
				});

				return exitCode ?? 1;
			};

			const openCodeDiff = async (file: FileInfo): Promise<void> => {
				if (file.status === "?" || file.status === "A") {
					await openCodeProjectFiles(pi, ctx.cwd, [file.file]);
					return;
				}
				await openCodeDiffs(pi, ctx.cwd, [{ before: writeTmpFile(path.basename(file.file), getHeadContent(file.file, ctx.cwd)), after: file.file }]);
			};

			const openVimDiff = async (file: FileInfo): Promise<void> => {
				if (file.status === "?" || file.status === "A") {
					const r = await runTerminal("vim", vimArgs(file.file));
					if (r !== 0) throw new Error(`vim exited ${r}`);
					return;
				}

				const tmpFile = writeTmpFile(path.basename(file.file), getHeadContent(file.file, ctx.cwd));
				const command = commandExists("vimdiff") ? "vimdiff" : "vim";
				const commandArgs = command === "vimdiff" ? vimArgs(tmpFile, file.file) : vimArgs("-d", tmpFile, file.file);
				const r = await runTerminal(command, commandArgs);
				if (r !== 0) throw new Error(`${command} exited ${r}`);
			};

			const openDiff = async (file: FileInfo): Promise<void> => {
				try {
					if (parsed.editor === "vim") await openVimDiff(file);
					else await openCodeDiff(file);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					throw new Error(`Failed to diff ${file.file}: ${msg}`);
				}
			};

			const openAllCodeDiffs = async (): Promise<{ opened: number; errors: string[] }> => {
				ensureTmpDir();
				const openable = files.filter((f) => f.status !== "D"); // Can't open deleted files
				const plainFiles = openable.filter((f) => f.status === "?" || f.status === "A").map((f) => f.file);
				const diffs = openable
					.filter((f) => f.status !== "?" && f.status !== "A")
					.map((f) => ({ before: writeTmpFile(path.basename(f.file), getHeadContent(f.file, ctx.cwd)), after: f.file }));

				try {
					if (plainFiles.length > 0) await openCodeProjectFiles(pi, ctx.cwd, plainFiles);
					if (diffs.length > 0) await openCodeDiffs(pi, ctx.cwd, diffs);
					return { opened: openable.length, errors: [] };
				} catch {
					return { opened: 0, errors: openable.map((f) => f.file) };
				}
			};

			const openAllVimDiffs = async (): Promise<{ opened: number; errors: string[] }> => {
				ensureTmpDir();
				const errors: string[] = [];
				let opened = 0;

				for (const f of files) {
					if (f.status === "D") continue; // Can't open deleted files
					try {
						await openVimDiff(f);
						opened += 1;
					} catch {
						errors.push(f.file);
					}
				}

				return { opened, errors };
			};

			const openAllDiffs = async (): Promise<{ opened: number; errors: string[] }> => {
				return parsed.editor === "vim" ? openAllVimDiffs() : openAllCodeDiffs();
			};

			// /diff all — skip picker, open everything
			if (parsed.all) {
				const { opened, errors } = await openAllDiffs();
				if (errors.length > 0) {
					ctx.ui.notify(`Opened ${opened} diff(s), ${errors.length} failed`, "warning");
				} else {
					ctx.ui.notify(`Opened ${opened} diff(s) in ${editorLabel(parsed.editor)}`, "info");
				}
				return;
			}

			if (!ctx.hasUI) {
				await openAllDiffs();
				return;
			}

			// Interactive picker
			ensureTmpDir();

			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const container = new Container();

				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				container.addChild(new Text(
					theme.fg("accent", theme.bold(" Diff ")) + theme.fg("muted", `${files.length} changed • ${editorLabel(parsed.editor)}`),
					0, 0,
				));

				const items: SelectItem[] = files.map((f) => {
					let statusColor: string;
					switch (f.status) {
						case "M": statusColor = theme.fg("warning", f.status); break;
						case "A": statusColor = theme.fg("success", f.status); break;
						case "D": statusColor = theme.fg("error", f.status); break;
						case "?": statusColor = theme.fg("muted", f.status); break;
						default:  statusColor = theme.fg("dim", f.status);
					}
					return { value: f, label: `${statusColor} ${f.file}` };
				});

				const visibleRows = Math.min(files.length, 15);
				let currentIndex = 0;

				const selectList = new SelectList(items, visibleRows, {
					selectedPrefix: (t) => theme.fg("accent", t),
					selectedText: (t) => t,
					description: (t) => theme.fg("muted", t),
					scrollInfo: (t) => theme.fg("dim", t),
					noMatch: (t) => theme.fg("warning", t),
				});

				selectList.onSelect = (item) => {
					done();
					openDiff(item.value as FileInfo).catch((err) => {
						ctx.ui.notify(err.message, "error");
					});
				};
				selectList.onCancel = () => done();
				selectList.onSelectionChange = (item) => {
					currentIndex = items.indexOf(item);
				};
				container.addChild(selectList);

				container.addChild(new Text(
					theme.fg("dim", " ↑↓ navigate • ←→ page • enter open • a open all • esc close"),
					0, 0,
				));
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => {
						if (matchesKey(data, "a")) {
							done();
							openAllDiffs().then(({ opened, errors }) => {
								if (errors.length > 0) {
									ctx.ui.notify(`Opened ${opened} diff(s), ${errors.length} failed`, "warning");
								} else {
									ctx.ui.notify(`Opened ${opened} diff(s) in ${editorLabel(parsed.editor)}`, "info");
								}
							}).catch((err) => {
								ctx.ui.notify(err.message, "error");
							});
							return;
						}
						if (matchesKey(data, Key.left)) {
							currentIndex = Math.max(0, currentIndex - visibleRows);
							selectList.setSelectedIndex(currentIndex);
						} else if (matchesKey(data, Key.right)) {
							currentIndex = Math.min(items.length - 1, currentIndex + visibleRows);
							selectList.setSelectedIndex(currentIndex);
						} else {
							selectList.handleInput(data);
						}
						tui.requestRender();
					},
				};
			});
		},
	});
}
