/**
 * /worktree command — create, list, and remove isolated git worktrees.
 *
 * This is intentionally conservative: it provisions the worktree and keeps the
 * current Pi session intact. When running inside cmux, it launches a new Pi
 * session in a new workspace for the new worktree. By default that session
 * opens idle without sending the task to the model; pass --autopilot to opt
 * into autonomous execution.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

function slugify(input: string): string {
	const slug = input
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-")
		.slice(0, 48);
	return slug || "task";
}

function shellQuote(value: string): string {
	return "'" + value.replace(/'/g, "'\\''") + "'";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCmux(): boolean {
	if (process.env.CMUX_WORKSPACE_ID) return true;
	try {
		const sockPath = process.env.CMUX_SOCKET_PATH
			?? `${process.env.HOME}/Library/Application Support/cmux/cmux.sock`;
		fs.accessSync(sockPath);
		return true;
	} catch {
		return false;
	}
}

function getWorktreesRoot(gitRoot: string): string {
	const repoName = path.basename(gitRoot);
	return path.join(path.dirname(gitRoot), `${repoName}-worktrees`);
}

type LaunchMode = "chat" | "autopilot";
type WorktreeSubcommand = "create" | "list" | "remove" | "delete";

interface WorktreeInfo {
	path: string;
	head?: string;
	branch?: string;
	detached: boolean;
	bare: boolean;
	locked?: string;
	prunable?: string;
}

interface ParsedArgs {
	subcommand: WorktreeSubcommand;
	task: string;
	launchMode: LaunchMode;
	target: string;
	force: boolean;
	yes: boolean;
}

function formatPiCommand(task: string, launchMode: LaunchMode): string {
	const sessionEnv = `PI_SESSION_NAME=${shellQuote(task)}`;
	return launchMode === "autopilot"
		? `${sessionEnv} pi ${shellQuote(`/autopilot ${task}`)}`
		: `${sessionEnv} pi`;
}

function formatLaunchCommand(worktreePath: string, task: string, launchMode: LaunchMode): string {
	return `cd ${shellQuote(worktreePath)} && ${formatPiCommand(task, launchMode)}`;
}

function parseWorktreeArgs(rawArgs?: string): ParsedArgs {
	const tokens = rawArgs?.trim().split(/\s+/).filter(Boolean) ?? [];
	const subcommand = tokens[0];
	if (subcommand === "list" || subcommand === "ls") {
		return { subcommand: "list", task: "", launchMode: "chat", target: "", force: false, yes: false };
	}
	if (subcommand === "remove" || subcommand === "rm") {
		const rest = tokens.slice(1);
		return {
			subcommand: "remove",
			task: "",
			launchMode: "chat",
			target: rest.filter((token) => !token.startsWith("--")).join(" "),
			force: rest.includes("--force") || rest.includes("-f"),
			yes: rest.includes("--yes") || rest.includes("-y"),
		};
	}
	if (subcommand === "delete") {
		const rest = tokens.slice(1);
		return {
			subcommand: "delete",
			task: "",
			launchMode: "chat",
			target: "",
			force: rest.includes("--force") || rest.includes("-f"),
			yes: rest.includes("--yes") || rest.includes("-y"),
		};
	}

	let launchMode: LaunchMode = "chat";
	let taskTokens = tokens;
	if (tokens[0] === "--autopilot") {
		launchMode = "autopilot";
		taskTokens = tokens.slice(1);
	}
	return { subcommand: "create", task: taskTokens.join(" "), launchMode, target: "", force: false, yes: false };
}

function extractWorkspaceRef(output: string): string | null {
	const match = output.match(/workspace:(\S+)/);
	return match ? `workspace:${match[1]}` : null;
}

function getWorkspaceTitle(worktreePath: string): string {
	const repoWorktreesDir = path.basename(path.dirname(worktreePath));
	const repoName = repoWorktreesDir.replace(/-worktrees$/, "");
	const slug = path.basename(worktreePath);
	return `${repoName} · ${slug}`;
}

function parseWorktreeList(output: string): WorktreeInfo[] {
	const entries: WorktreeInfo[] = [];
	for (const block of output.trim().split(/\n\s*\n/)) {
		if (!block.trim()) continue;
		const entry: WorktreeInfo = { path: "", detached: false, bare: false };
		for (const line of block.split("\n")) {
			const [key, ...rest] = line.split(" ");
			const value = rest.join(" ");
			if (key === "worktree") entry.path = value;
			else if (key === "HEAD") entry.head = value;
			else if (key === "branch") entry.branch = value.replace(/^refs\/heads\//, "");
			else if (key === "detached") entry.detached = true;
			else if (key === "bare") entry.bare = true;
			else if (key === "locked") entry.locked = value || "locked";
			else if (key === "prunable") entry.prunable = value || "prunable";
		}
		if (entry.path) entries.push(entry);
	}
	return entries;
}

function samePath(a: string, b: string): boolean {
	try {
		return fs.realpathSync.native(a) === fs.realpathSync.native(b);
	} catch {
		return path.resolve(a) === path.resolve(b);
	}
}

function isMainWorktree(worktrees: WorktreeInfo[], worktree: WorktreeInfo): boolean {
	return worktrees.length > 0 && samePath(worktrees[0].path, worktree.path);
}

function describeWorktree(worktree: WorktreeInfo, worktrees: WorktreeInfo[], currentRoot: string): string {
	const parts: string[] = [];
	if (samePath(worktree.path, currentRoot)) parts.push("current");
	if (isMainWorktree(worktrees, worktree)) parts.push("main");
	if (worktree.locked) parts.push("locked");
	if (worktree.prunable) parts.push("prunable");
	const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
	const branch = worktree.branch ?? (worktree.detached ? "detached" : "unknown");
	return `- ${worktree.path}\n  branch: ${branch}${suffix}`;
}

function findWorktree(worktrees: WorktreeInfo[], target: string): WorktreeInfo[] {
	const clean = target.trim();
	if (!clean) return [];
	return worktrees.filter((worktree) => {
		return worktree.path === clean
			|| path.basename(worktree.path) === clean
			|| worktree.branch === clean
			|| worktree.branch === `wt/${clean}`;
	});
}

export default function (pi: ExtensionAPI) {
	async function gitRoot(ctx: ExtensionCommandContext): Promise<string | null> {
		const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd: ctx.cwd });
		if (rootResult.code !== 0) {
			ctx.ui.notify("/worktree requires a git repository", "error");
			return null;
		}
		return rootResult.stdout.trim();
	}

	async function worktrees(ctx: ExtensionCommandContext, cwd?: string): Promise<WorktreeInfo[] | null> {
		const listResult = await pi.exec("git", ["worktree", "list", "--porcelain"], { cwd: cwd ?? ctx.cwd });
		if (listResult.code !== 0) {
			const reason = listResult.stderr.trim() || listResult.stdout.trim() || "git worktree list failed";
			ctx.ui.notify(reason, "error");
			return null;
		}
		return parseWorktreeList(listResult.stdout);
	}

	async function localBranchExists(branchName: string): Promise<boolean> {
		const { code } = await pi.exec("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`]);
		return code === 0;
	}

	async function getUniqueTarget(gitRoot: string, task: string): Promise<{
		slug: string;
		branchName: string;
		worktreePath: string;
	}> {
		const worktreesRoot = getWorktreesRoot(gitRoot);
		const baseSlug = slugify(task);

		let slug = baseSlug;
		let branchName = `wt/${slug}`;
		let worktreePath = path.join(worktreesRoot, slug);
		let suffix = 2;

		while (fs.existsSync(worktreePath) || (await localBranchExists(branchName))) {
			slug = `${baseSlug}-${suffix}`;
			branchName = `wt/${slug}`;
			worktreePath = path.join(worktreesRoot, slug);
			suffix++;
		}

		return { slug, branchName, worktreePath };
	}

	async function launchPiInCmuxWorkspace(worktreePath: string, task: string, launchMode: LaunchMode): Promise<{ launched: boolean; workspaceRef?: string; workspaceTitle?: string; error?: string }> {
		if (!isCmux()) return { launched: false };

		const piCommand = formatPiCommand(task, launchMode);
		const createResult = await pi.exec("cmux", [
			"new-workspace",
			"--cwd",
			worktreePath,
			"--command",
			piCommand,
		]);
		if (createResult.code !== 0) {
			return {
				launched: false,
				error: createResult.stderr.trim() || createResult.stdout.trim() || "failed to create cmux workspace",
			};
		}

		const workspaceRef = extractWorkspaceRef(createResult.stdout || createResult.stderr || "") ?? undefined;
		const workspaceTitle = getWorkspaceTitle(worktreePath);
		if (workspaceRef) {
			await sleep(200);
			await pi.exec("cmux", ["rename-workspace", "--workspace", workspaceRef, workspaceTitle]);
		}

		return { launched: true, workspaceRef, workspaceTitle };
	}

	async function isDirty(worktreePath: string): Promise<boolean> {
		const status = await pi.exec("git", ["status", "--porcelain"], { cwd: worktreePath });
		return status.code === 0 && status.stdout.trim().length > 0;
	}

	async function removeWorktree(ctx: ExtensionCommandContext, worktreesList: WorktreeInfo[], target: WorktreeInfo, opts: { force: boolean; yes: boolean; shutdown: boolean }): Promise<void> {
		if (isMainWorktree(worktreesList, target)) {
			ctx.ui.notify("Refusing to remove the main worktree", "error");
			return;
		}
		if (!opts.force && await isDirty(target.path)) {
			ctx.ui.notify(`Worktree has uncommitted changes: ${target.path}. Use --force to remove it anyway.`, "error");
			return;
		}
		if (ctx.hasUI && !opts.yes) {
			const branch = target.branch ? `\nBranch remains: ${target.branch}` : "";
			const ok = await ctx.ui.confirm("Remove worktree?", `Remove ${target.path}?${branch}`);
			if (!ok) return;
		} else if (!ctx.hasUI && !opts.yes) {
			ctx.ui.notify("Use --yes to remove a worktree without interactive confirmation", "warning");
			return;
		}

		const mainWorktree = worktreesList[0]?.path;
		if (opts.shutdown) {
			try { process.chdir(os.homedir()); } catch {}
		}
		const removeResult = await pi.exec("git", ["worktree", "remove", ...(opts.force ? ["--force"] : []), target.path], { cwd: mainWorktree ?? ctx.cwd });
		if (removeResult.code !== 0) {
			const reason = removeResult.stderr.trim() || removeResult.stdout.trim() || "git worktree remove failed";
			ctx.ui.notify(reason, "error");
			return;
		}

		ctx.ui.notify(`Removed worktree: ${target.path}`, "info");
		if (opts.shutdown) ctx.shutdown();
	}

	async function listHandler(ctx: ExtensionCommandContext): Promise<void> {
		const gitRootPath = await gitRoot(ctx);
		if (!gitRootPath) return;
		const worktreesList = await worktrees(ctx, gitRootPath);
		if (!worktreesList) return;
		const message = [
			`Git worktrees for ${gitRootPath}`,
			"",
			...worktreesList.map((worktree) => describeWorktree(worktree, worktreesList, gitRootPath)),
			"",
			"Remove one with `/worktree remove <name-or-branch-or-path>`.",
			"Delete the current linked worktree with `/worktree delete`.",
		].join("\n");
		pi.sendMessage({
			customType: "worktree-list",
			content: [{ type: "text", text: message }],
			display: "user",
		});
	}

	async function removeHandler(parsedArgs: ParsedArgs, ctx: ExtensionCommandContext): Promise<void> {
		const gitRootPath = await gitRoot(ctx);
		if (!gitRootPath) return;
		const worktreesList = await worktrees(ctx, gitRootPath);
		if (!worktreesList) return;
		let target = parsedArgs.target;
		if (!target && ctx.hasUI) {
			const choices = worktreesList
				.filter((worktree) => !isMainWorktree(worktreesList, worktree))
				.map((worktree) => `${path.basename(worktree.path)} — ${worktree.branch ?? worktree.path}`);
			const selected = choices.length > 0 ? await ctx.ui.select("Remove worktree", choices) : undefined;
			if (!selected) return;
			target = selected.split(" — ")[0] ?? "";
		}
		const matches = findWorktree(worktreesList, target);
		if (matches.length === 0) {
			ctx.ui.notify("No matching worktree found", "error");
			return;
		}
		if (matches.length > 1) {
			ctx.ui.notify("Multiple worktrees matched; use the full path or branch name", "error");
			return;
		}
		await removeWorktree(ctx, worktreesList, matches[0], { force: parsedArgs.force, yes: parsedArgs.yes, shutdown: false });
	}

	async function deleteCurrentHandler(parsedArgs: ParsedArgs, ctx: ExtensionCommandContext): Promise<void> {
		const gitRootPath = await gitRoot(ctx);
		if (!gitRootPath) return;
		const worktreesList = await worktrees(ctx, gitRootPath);
		if (!worktreesList) return;
		const current = worktreesList.find((worktree) => samePath(worktree.path, gitRootPath));
		if (!current || isMainWorktree(worktreesList, current)) {
			ctx.ui.notify("/worktree delete only works from inside a linked git worktree", "error");
			return;
		}
		await removeWorktree(ctx, worktreesList, current, { force: parsedArgs.force, yes: parsedArgs.yes, shutdown: true });
	}

	async function createHandler(parsedArgs: ParsedArgs, ctx: ExtensionCommandContext): Promise<void> {
		let task = parsedArgs.task;
		const launchMode = parsedArgs.launchMode;
		if (!task && ctx.hasUI) {
			task = (await ctx.ui.input("New worktree task", "add oauth login"))?.trim() || "";
		}

		if (!task) {
			ctx.ui.notify("Usage: /worktree [--autopilot] <task>", "warning");
			return;
		}

		const gitRootPath = await gitRoot(ctx);
		if (!gitRootPath) return;

		const branchResult = await pi.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd });
		const currentBranch = branchResult.stdout.trim();
		const baseRef = currentBranch || "HEAD";

		const statusResult = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd });
		const currentDirty = statusResult.stdout.trim().length > 0;
		if (currentDirty && ctx.hasUI) {
			const ok = await ctx.ui.confirm(
				"Current worktree has uncommitted changes",
				[
					`The new worktree will be created from ${baseRef} at HEAD only.`,
					"Uncommitted changes in the current checkout will not be copied.",
					"Continue?",
				].join("\n\n"),
			);
			if (!ok) return;
		}

		const { branchName, worktreePath } = await getUniqueTarget(gitRootPath, task);
		fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

		const addResult = await pi.exec("git", ["worktree", "add", "-b", branchName, worktreePath], { cwd: gitRootPath });
		if (addResult.code !== 0) {
			const reason = addResult.stderr.trim() || addResult.stdout.trim() || "git worktree add failed";
			ctx.ui.notify(reason, "error");
			return;
		}

		const launchCommand = formatLaunchCommand(worktreePath, task, launchMode);
		const autopilotCommand = launchMode === "chat"
			? formatLaunchCommand(worktreePath, task, "autopilot")
			: undefined;
		const launchResult = await launchPiInCmuxWorkspace(worktreePath, task, launchMode);
		const launchedInCmux = launchResult.launched;
		const message = [
			`🌱 Created worktree \`${worktreePath}\``,
			"",
			`- Branch: \`${branchName}\``,
			`- Base: \`${baseRef}\``,
			`- Launch mode: \`${launchMode}\``,
			currentDirty ? "- Note: uncommitted changes in the current checkout were not copied" : "",
			launchedInCmux
				? `- Launched: new Pi session in ${launchResult.workspaceTitle ?? "a new workspace"}${launchResult.workspaceRef ? ` (${launchResult.workspaceRef})` : ""}`
				: "",
			!launchedInCmux && launchResult.error ? `- Launch error: ${launchResult.error}` : "",
			"",
			launchedInCmux ? "Fallback / manual launch:" : "Suggested next step:",
			"```bash",
			launchCommand,
			"```",
			autopilotCommand ? "Optional autopilot launch:" : "",
			autopilotCommand ? "```bash" : "",
			autopilotCommand ?? "",
			autopilotCommand ? "```" : "",
		].filter(Boolean).join("\n");

		pi.sendMessage({
			customType: "worktree-status",
			content: [{ type: "text", text: message }],
			display: "user",
		});
		ctx.ui.notify(
			launchedInCmux ? `Worktree created and launched: ${branchName}` : `Worktree created: ${branchName}`,
			"info",
		);
	}

	const handler = async (args: string, ctx: ExtensionCommandContext) => {
		const parsedArgs = parseWorktreeArgs(args);
		if (parsedArgs.subcommand === "list") return listHandler(ctx);
		if (parsedArgs.subcommand === "remove") return removeHandler(parsedArgs, ctx);
		if (parsedArgs.subcommand === "delete") return deleteCurrentHandler(parsedArgs, ctx);
		return createHandler(parsedArgs, ctx);
	};

	pi.registerCommand("worktree", {
		description:
			"Create, list, or remove git worktrees: /worktree <task>, /worktree list, /worktree remove <name>, /worktree delete",
		getArgumentCompletions: (prefix) => {
			return ["list", "remove", "delete", "--autopilot"]
				.filter((value) => value.startsWith(prefix))
				.map((value) => ({ value, label: value }));
		},
		handler,
	});
}
