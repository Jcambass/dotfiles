/**
 * Quick Chat — a lightweight, unrelated conversation with no git worktree,
 * no project ceremony, and no workstream registry entry.
 *
 * For things like rewording a message, monitoring a PR's CI, or any other
 * one-off task that doesn't belong in whatever repo/workstream the current
 * session is already focused on. Each quick chat gets its own fresh scratch
 * directory so it never touches or gets confused with a real project.
 *
 * /qc [task]   open a new quick chat in a new cmux tab
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureWorkspaceInGroup, extractWorkspaceRef, formatPiCommand, isCmux } from "./lib/cmux.js";
import { writeSessionName } from "./lib/workstreams.js";

const QUICK_CHAT_GROUP_NAME = "Quick Chats";

export default function quickChatExtension(pi: ExtensionAPI) {
	pi.registerCommand("qc", {
		description: "Open a quick chat for something unrelated: /qc [task]. Fresh scratch dir, own cmux tab, no git/project ceremony.",
		handler: async (args, ctx) => {
			let task = args.trim();
			if (!task && ctx.hasUI) {
				task = (await ctx.ui.input("Quick chat about", "reword this email"))?.trim() ?? "";
			}
			if (!task) {
				ctx.ui.notify("Usage: /qc <task>", "warning");
				return;
			}

			if (!isCmux()) {
				ctx.ui.notify("/qc requires cmux to open a new tab", "error");
				return;
			}

			const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-qc-"));
			try {
				writeSessionName(tempDir, task);
			} catch {
				// non-fatal — PI_SESSION_NAME below still names the session
			}

			const piCommand = formatPiCommand(task);
			const createResult = await pi.exec("cmux", [
				"new-workspace", "--cwd", tempDir, "--command", piCommand, "--focus", "true",
			]);
			if (createResult.code !== 0) {
				const reason =
					createResult.stderr.trim() || createResult.stdout.trim() || "cmux new-workspace failed";
				ctx.ui.notify(reason, "error");
				return;
			}

			const workspaceRef = extractWorkspaceRef(createResult.stdout || createResult.stderr || "");
			if (workspaceRef) {
				await pi.exec("cmux", ["rename-workspace", "--workspace", workspaceRef, `qc: ${task}`]);
				await ensureWorkspaceInGroup(pi, { ref: workspaceRef }, QUICK_CHAT_GROUP_NAME);
				await pi.exec("cmux", ["select-workspace", "--workspace", workspaceRef]);
			}

			ctx.ui.notify(`Quick chat opened: ${task}`, "info");
		},
	});
}
