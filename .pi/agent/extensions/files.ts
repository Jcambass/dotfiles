/**
 * Files Extension
 *
 * /files command lists all files the model has read/written/edited in the active session branch,
 * coalesced by path and sorted newest first. Selecting a file opens it in VS Code Insiders.
 * Press `a` to open all files at once.
 *
 * /files vim opens selected files in Vim instead, with Pi's TUI suspended while Vim runs.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { spawnSync } from "node:child_process";
import { editorLabel, openCodeProjectFiles, type EditorMode, vimArgs } from "./lib/editor.js";

interface FileEntry {
	path: string;
	operations: Set<"read" | "write" | "edit">;
	lastTimestamp: number;
}

type FileToolName = "read" | "write" | "edit";

function parseEditorMode(args: string | undefined): EditorMode {
	const tokens = args?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
	return tokens.some((t) => t === "vim" || t === "vi" || t === "nvim") ? "vim" : "code";
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("files", {
		description: "Show files read/written/edited in this session (/files [vim])",
		handler: async (args, ctx) => {
			const editor = parseEditorMode(args);

			if (!ctx.hasUI) {
				ctx.ui.notify("No UI available", "error");
				return;
			}

			if (editor === "vim" && ctx.mode !== "tui") {
				ctx.ui.notify("Vim mode requires Pi TUI", "error");
				return;
			}

			// Get the current branch (path from leaf to root)
			const branch = ctx.sessionManager.getBranch();

			// First pass: collect tool calls (id -> {path, name}) from assistant messages
			const toolCalls = new Map<string, { path: string; name: FileToolName; timestamp: number }>();

			for (const entry of branch) {
				if (entry.type !== "message") continue;
				const msg = entry.message;

				if (msg.role === "assistant" && Array.isArray(msg.content)) {
					for (const block of msg.content) {
						if (block.type === "toolCall") {
							const name = block.name;
							if (name === "read" || name === "write" || name === "edit") {
								const path = block.arguments?.path;
								if (path && typeof path === "string") {
									toolCalls.set(block.id, { path, name, timestamp: msg.timestamp });
								}
							}
						}
					}
				}
			}

			// Second pass: match tool results to get the actual execution timestamp
			const fileMap = new Map<string, FileEntry>();

			for (const entry of branch) {
				if (entry.type !== "message") continue;
				const msg = entry.message;

				if (msg.role === "toolResult") {
					const toolCall = toolCalls.get(msg.toolCallId);
					if (!toolCall) continue;

					const { path, name } = toolCall;
					const timestamp = msg.timestamp;

					const existing = fileMap.get(path);
					if (existing) {
						existing.operations.add(name);
						if (timestamp > existing.lastTimestamp) {
							existing.lastTimestamp = timestamp;
						}
					} else {
						fileMap.set(path, {
							path,
							operations: new Set([name]),
							lastTimestamp: timestamp,
						});
					}
				}
			}

			if (fileMap.size === 0) {
				ctx.ui.notify("No files read/written/edited in this session", "info");
				return;
			}

			// Sort by most recent first
			const files = Array.from(fileMap.values()).sort((a, b) => b.lastTimestamp - a.lastTimestamp);

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

			const openFiles = async (selectedFiles: FileEntry[]): Promise<void> => {
				const paths = selectedFiles.map((file) => file.path);
				try {
					if (editor === "vim") {
						const r = await runTerminal("vim", vimArgs(...paths));
						if (r !== 0) ctx.ui.notify(`Failed to open ${paths.length} file(s) in Vim`, "error");
						return;
					}

					await openCodeProjectFiles(pi, ctx.cwd, paths);
					ctx.ui.notify(`Opened ${paths.length} file(s) in VS Code Insiders`, "info");
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Failed to open ${paths.length} file(s) in ${editorLabel(editor)}: ${message}`, "error");
				}
			};

			const openSelected = (file: FileEntry): void => {
				void openFiles([file]);
			};

			// Show file picker with SelectList
			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				const container = new Container();

				// Top border
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				// Title
				container.addChild(new Text(
					theme.fg("accent", theme.bold(" Select file to open")) + theme.fg("muted", ` • ${editorLabel(editor)}`),
					0, 0,
				));

				// Build select items with colored operations
				const items: SelectItem[] = files.map((f) => {
					const ops: string[] = [];
					if (f.operations.has("read")) ops.push(theme.fg("muted", "R"));
					if (f.operations.has("write")) ops.push(theme.fg("success", "W"));
					if (f.operations.has("edit")) ops.push(theme.fg("warning", "E"));
					const opsLabel = ops.join("");
					return {
						value: f,
						label: `${opsLabel} ${f.path}`,
					};
				});

				const visibleRows = Math.min(files.length, 15);
				let currentIndex = 0;

				const selectList = new SelectList(items, visibleRows, {
					selectedPrefix: (t) => theme.fg("accent", t),
					selectedText: (t) => t, // Keep existing colors
					description: (t) => theme.fg("muted", t),
					scrollInfo: (t) => theme.fg("dim", t),
					noMatch: (t) => theme.fg("warning", t),
				});
				selectList.onSelect = (item) => {
					done();
					void openSelected(item.value as FileEntry);
				};
				selectList.onCancel = () => done();
				selectList.onSelectionChange = (item) => {
					currentIndex = items.indexOf(item);
				};
				container.addChild(selectList);

				// Help text
				container.addChild(
					new Text(theme.fg("dim", " ↑↓ navigate • ←→ page • enter open • a open all • esc close"), 0, 0),
				);

				// Bottom border
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => {
						if (matchesKey(data, "a")) {
							done();
							void openFiles(files);
							return;
						}

						// Add paging with left/right
						if (matchesKey(data, Key.left)) {
							// Page up - clamp to 0
							currentIndex = Math.max(0, currentIndex - visibleRows);
							selectList.setSelectedIndex(currentIndex);
						} else if (matchesKey(data, Key.right)) {
							// Page down - clamp to last
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
