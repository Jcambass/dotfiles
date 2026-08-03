/**
 * PR Watch -- keep an eye on a set of PRs without leaving the current tab.
 *
 * Opens `pr-watch` (Go + Bubble Tea; common/github/pr-watch, wrapper at
 * common/github/bin/pr-watch) in a new pane split in the current cmux
 * workspace, instead of a new tab/workspace, since this is meant to sit
 * alongside whatever you're already doing.
 *
 * /prs [ref ...]         watch these PRs in a new split (not persisted)
 * /prs                   watch the persisted list in a new split
 * /prs add <ref ...>     add ref(s) to the persisted list
 * /prs remove <ref ...>  remove ref(s) from the persisted list
 * /prs list              show the persisted list
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isCmux, shellQuote, sleep } from "./lib/cmux.js";

const PR_WATCH_BIN = "pr-watch";
const LIST_SUBCOMMANDS = new Set(["add", "remove", "list"]);

export default function prWatchExtension(pi: ExtensionAPI) {
	pi.registerCommand("prs", {
		description:
			"Watch PRs in a new cmux split: /prs [ref ...] to watch, /prs add|remove|list to manage the saved list.",
		handler: async (args, ctx) => {
			const parts = args.trim().length ? args.trim().split(/\s+/) : [];
			const [sub, ...rest] = parts;

			if (sub && LIST_SUBCOMMANDS.has(sub)) {
				if (sub !== "list" && rest.length === 0) {
					ctx.ui.notify(`Usage: /prs ${sub} <ref> [<ref> ...]`, "warning");
					return;
				}
				const cliArgs = sub === "list" ? ["--list"] : [`--${sub}`, ...rest];
				const result = await pi.exec(PR_WATCH_BIN, cliArgs);
				const output = (result.stdout || result.stderr || "").trim();
				if (result.code !== 0) {
					ctx.ui.notify(output || `pr-watch --${sub} failed`, "error");
					return;
				}
				ctx.ui.notify(output || `/prs ${sub} done`, "info");
				return;
			}

			if (!isCmux()) {
				ctx.ui.notify(
					"/prs requires cmux to open a split pane. Use /prs add|remove|list to manage the saved list without one.",
					"error",
				);
				return;
			}

			const refs = parts;
			const command = refs.length ? `${PR_WATCH_BIN} ${refs.map(shellQuote).join(" ")}` : PR_WATCH_BIN;

			const splitResult = await pi.exec("cmux", ["new-split", "right"]);
			if (splitResult.code !== 0) {
				const reason = splitResult.stderr.trim() || splitResult.stdout.trim() || "cmux new-split failed";
				ctx.ui.notify(reason, "error");
				return;
			}
			const surfaceMatch = (splitResult.stdout || splitResult.stderr || "").match(/surface:(\S+)/);
			if (!surfaceMatch) {
				ctx.ui.notify("Split created but couldn't find its surface id", "error");
				return;
			}
			const surfaceRef = `surface:${surfaceMatch[1]}`;

			await pi.exec("cmux", ["send", "--surface", surfaceRef, command]);
			await sleep(150);
			await pi.exec("cmux", ["send-key", "--surface", surfaceRef, "enter"]);

			ctx.ui.notify(
				refs.length ? `Watching ${refs.length} PR(s) in a new split` : "Watching your saved PR list in a new split",
				"info",
			);
		},
	});
}
