/**
 * /projects — open projects, manage workstreams
 * /ws       — workstream picker and management
 *
 * Projects are parent repos/contexts identified by git remote origin URL or
 * real path. Workstreams are focused task contexts backed by git worktrees,
 * Pi conversations, and optional cmux workspaces.
 *
 * /projects [query]      open a project by selecting or creating a workstream
 * /projects new [task]   create a new workstream in the current project
 * /projects list         list discovered projects
 * /ws                    interactive workstream picker for current project
 * /ws list               list workstreams in current project (or all registered)
 * /ws remove [name]      remove a linked workstream
 * /ws delete             remove the current linked workstream and end Pi conversation
 * /ws fork [name]        fork current WIP into a new workstream
 */

import {
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, Text, type SettingItem } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	deriveTaskFromWorktree,
	discoverProjects,
	findByWorktreePath,
	findProjects,
	getUniqueWorkstreamTarget,
	isMainWorktree,
	parseWorktreeList,
	primaryLabel,
	projectInfoForPath,
	readRegistry,
	readSessionName,
	removeWorkstream,
	samePath,
	upsertWorkstream,
	workstreamId,
	writeSessionName,
	type ProjectInfo,
	type WorkstreamRecord,
	type WorkstreamView,
	type WorktreeInfo,
} from "./lib/workstreams.js";
import {
	findWorkspaceForPath,
	isCmux,
	launchPiWorkspace,
	openOrSwitchWorkspace,
} from "./lib/cmux.js";

const WORKSTREAM_STATUS_KEY = "workstream";
const NEW_WORKSTREAM_ID = "__new__";
const PRIMARY_ID = "__primary__";

export default function workstreamsExtension(pi: ExtensionAPI) {
	// ── Session lifecycle ────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const cwd = ctx.cwd;
		const { workstreams } = readRegistry();
		const record = findByWorktreePath(cwd, workstreams);
		const sessionNameFromFile = readSessionName(cwd);
		const task = record?.task ?? sessionNameFromFile;

		// Set session name if not already set
		const currentName = pi.getSessionName();
		if (task && !currentName) {
			pi.setSessionName(task);
		}

		// Update registry with session file and cmux workspace ref
		if (record) {
			const sessionFile = ctx.sessionManager.getSessionFile();
			const cmuxRef = process.env.CMUX_WORKSPACE_ID
				? `workspace:${process.env.CMUX_WORKSPACE_ID}`
				: undefined;
			upsertWorkstream({
				...record,
				...(sessionFile ? { sessionFile } : {}),
				...(cmuxRef ? { cmuxWorkspaceRef: cmuxRef } : {}),
			});
		}

		// Set workstream status widget
		const effectiveName = pi.getSessionName() ?? task;
		if (effectiveName) {
			const projectName = record?.projectName ?? path.basename(cwd);
			ctx.ui.setStatus(WORKSTREAM_STATUS_KEY, `Workstream: ${projectName} · ${effectiveName}`);
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus(WORKSTREAM_STATUS_KEY, undefined);
	});

	// ── Core helpers ─────────────────────────────────────────────────────────

	/**
	 * Resolve the main project root from any directory inside the repo.
	 * Handles linked worktrees by reading `git worktree list --porcelain` entry 0.
	 * Returns null when not inside a git repository.
	 */
	async function resolveMainRoot(cwd: string): Promise<string | null> {
		const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
		if (rootResult.code !== 0) return null;
		const currentRoot = rootResult.stdout.trim();

		const listResult = await pi.exec("git", ["worktree", "list", "--porcelain"], {
			cwd: currentRoot,
		});
		if (listResult.code !== 0) return currentRoot;

		const worktrees = parseWorktreeList(listResult.stdout);
		return worktrees[0]?.path ?? currentRoot;
	}

	/**
	 * Create a new workstream: git worktree, .pi/session-name, registry, cmux launch.
	 */
	async function doCreateWorkstream(
		ctx: ExtensionCommandContext,
		project: ProjectInfo,
		mainRoot: string,
		task: string,
	): Promise<void> {
		// Warn if main checkout is dirty — new worktree starts from HEAD only
		const statusResult = await pi.exec("git", ["status", "--porcelain"], { cwd: mainRoot });
		const dirty = statusResult.code === 0 && statusResult.stdout.trim().length > 0;
		if (dirty) {
			const message = [
				"New workstream will start from HEAD only.",
				"Use `/ws fork` to copy current WIP.",
				"Continue?",
			].join("\n\n");
			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm("Uncommitted changes in main checkout", message);
				if (!ok) return;
			} else {
				ctx.ui.notify(
					"Uncommitted changes present. New workstream starts from HEAD only.",
					"warning",
				);
			}
		}

		// Generate unique slug/branch/path
		const { slug, branchName, worktreePath } = getUniqueWorkstreamTarget(mainRoot, task);

		// Create the worktree
		const addResult = await pi.exec(
			"git",
			["worktree", "add", "-b", branchName, worktreePath],
			{ cwd: mainRoot },
		);
		if (addResult.code !== 0) {
			const reason =
				addResult.stderr.trim() || addResult.stdout.trim() || "git worktree add failed";
			ctx.ui.notify(reason, "error");
			return;
		}

		// Write .pi/session-name so future sessions auto-name themselves
		try {
			writeSessionName(worktreePath, task);
		} catch {
			// non-fatal
		}

		// Upsert registry record
		const now = new Date().toISOString();
		const record: WorkstreamRecord = {
			id: workstreamId(project.projectId, slug),
			projectId: project.projectId,
			projectName: project.name,
			projectPath: project.path,
			projectRemoteUrl: project.remoteUrl,
			task,
			slug,
			branch: branchName,
			worktreePath,
			primary: false,
			createdAt: now,
			updatedAt: now,
		};
		upsertWorkstream(record);

		// Launch in cmux
		let launchLine = "cmux not available — open manually";
		if (isCmux()) {
			const result = await launchPiWorkspace(pi, {
				worktreePath,
				projectName: project.name,
				task,
				slug,
				primary: false,
			});
			launchLine = result.launched
				? `Launched: ${result.workspaceTitle ?? slug}`
				: result.error
					? `Launch failed: ${result.error}`
					: "Launch skipped";
		}

		const message = [
			"🌱 Workstream created",
			"",
			`- Project: ${project.name}`,
			`- Task: ${task}`,
			`- Branch: \`${branchName}\``,
			`- Path: ${worktreePath}`,
			`- ${launchLine}`,
		].join("\n");

		pi.sendMessage({
			customType: "workstream-created",
			content: [{ type: "text", text: message }],
			display: "user",
		});

		ctx.ui.notify(`Workstream created: ${task}`, "info");
	}

	/** Open or switch to a linked workstream worktree in cmux. */
	async function openWorkstream(
		ctx: ExtensionCommandContext,
		worktree: WorktreeInfo,
		project: ProjectInfo,
		record?: WorkstreamRecord,
	): Promise<void> {
		const task = deriveTaskFromWorktree(worktree, record);
		const slug = record?.slug ?? path.basename(worktree.path);
		await openOrSwitchWorkspace(pi, ctx, {
			worktreePath: worktree.path,
			projectName: project.name,
			task,
			slug,
			primary: false,
		});
	}

	/** Open or switch to the primary (main) checkout of a project in cmux. */
	async function openPrimaryCheckout(
		ctx: ExtensionCommandContext,
		project: ProjectInfo,
		mainWorktree?: WorktreeInfo,
	): Promise<void> {
		const worktreePath = mainWorktree?.path ?? project.path;
		await openOrSwitchWorkspace(pi, ctx, {
			worktreePath,
			projectName: project.name,
			task: "Primary checkout",
			slug: "primary",
			primary: true,
		});
	}

	// ── Project list / picker ─────────────────────────────────────────────────

	function sendProjectsList(projects: ProjectInfo[]): void {
		const message = [
			"Projects",
			"",
			...projects.map((p) => `- ${p.label} — ${p.path}`),
			"",
			"Open one with `/projects <name>`.",
		].join("\n");
		pi.sendMessage({
			customType: "projects-list",
			content: [{ type: "text", text: message }],
			display: "user",
		});
	}

	async function selectProject(
		ctx: ExtensionCommandContext,
		projects: ProjectInfo[],
		title = "Projects",
	): Promise<ProjectInfo | undefined> {
		const projectById = new Map(projects.map((p) => [p.path, p]));

		return ctx.ui.custom<ProjectInfo | undefined>((_tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(
				new Text(
					theme.fg("accent", theme.bold(` ${title}`)) +
						theme.fg("muted", ` • ${projects.length} projects`),
					0,
					0,
				),
			);

			const items: SettingItem[] = projects.map((p) => ({
				id: p.path,
				label: p.label,
				description: p.path,
				currentValue: "open",
				values: ["open"],
			}));

			const settingsList = new SettingsList(
				items,
				Math.min(projects.length, 15),
				{
					label: (text, selected) => (selected ? theme.fg("accent", text) : text),
					value: (text, selected) =>
						selected ? theme.fg("accent", text) : theme.fg("muted", text),
					description: (text) => theme.fg("muted", text),
					cursor: theme.fg("accent", "→ "),
					hint: (text) => theme.fg("dim", text),
				},
				(id) => {
					done(projectById.get(id));
				},
				() => done(undefined),
				{ enableSearch: true },
			);
			container.addChild(settingsList);
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			return {
				render: (width) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data) => {
					settingsList.handleInput(data);
					_tui.requestRender();
				},
			};
		});
	}

	// ── Workstream picker ─────────────────────────────────────────────────────

	/**
	 * Show a workstream picker for the given project.
	 * Items: New workstream…, primary checkout, linked worktrees.
	 * Returns the selected item id, or undefined on cancel.
	 */
	async function selectWorkstream(
		ctx: ExtensionCommandContext,
		project: ProjectInfo,
		worktrees: WorktreeInfo[],
		records: WorkstreamRecord[],
	): Promise<string | undefined> {
		const mainWorktree = worktrees[0];
		const linked = worktrees.slice(1);

		interface ItemMeta {
			id: string;
			label: string;
			description: string;
		}
		const itemMetas: ItemMeta[] = [];

		itemMetas.push({ id: NEW_WORKSTREAM_ID, label: "New workstream…", description: "" });

		if (mainWorktree) {
			const branch = mainWorktree.branch ?? (mainWorktree.detached ? "detached" : "unknown");
			itemMetas.push({
				id: PRIMARY_ID,
				label: primaryLabel(mainWorktree),
				description: `branch: ${branch} · ${mainWorktree.path}`,
			});
		}

		for (const wt of linked) {
			const record = records.find((r) => samePath(r.worktreePath, wt.path));
			const task = deriveTaskFromWorktree(wt, record);
			const slug = record?.slug ?? path.basename(wt.path);
			const branch = wt.branch ?? (wt.detached ? "detached" : "");
			itemMetas.push({
				id: wt.path,
				label: task,
				description: branch ? `branch: ${branch} · checkout: ${slug}` : `checkout: ${slug}`,
			});
		}

		const count = itemMetas.length;

		return ctx.ui.custom<string | undefined>((_tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(
				new Text(
					theme.fg("accent", theme.bold(` ${project.name}`)) +
						theme.fg(
							"muted",
							` • ${linked.length} workstream${linked.length === 1 ? "" : "s"}`,
						),
					0,
					0,
				),
			);

			const items: SettingItem[] = itemMetas.map((item) => ({
				id: item.id,
				label: item.label,
				description: item.description,
				currentValue: "select",
				values: ["select"],
			}));

			const settingsList = new SettingsList(
				items,
				Math.min(count, 15),
				{
					label: (text, selected) => (selected ? theme.fg("accent", text) : text),
					value: (text, selected) =>
						selected ? theme.fg("accent", text) : theme.fg("muted", text),
					description: (text) => theme.fg("muted", text),
					cursor: theme.fg("accent", "→ "),
					hint: (text) => theme.fg("dim", text),
				},
				(id) => {
					done(id);
				},
				() => done(undefined),
				{ enableSearch: true },
			);
			container.addChild(settingsList);
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			return {
				render: (width) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data) => {
					settingsList.handleInput(data);
					_tui.requestRender();
				},
			};
		});
	}

	/**
	 * Open a project's workstream view: list worktrees, show picker or guide creation.
	 */
	async function openProjectWorkstreams(
		ctx: ExtensionCommandContext,
		project: ProjectInfo,
	): Promise<void> {
		// Confirm it's a git repo
		const gitCheckResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
			cwd: project.path,
		});
		if (gitCheckResult.code !== 0) {
			ctx.ui.notify(
				`${project.name} is not a git repository. Opening primary checkout. (Workstreams require git.)`,
				"warning",
			);
			await openOrSwitchWorkspace(pi, ctx, {
				worktreePath: project.path,
				projectName: project.name,
				task: project.name,
				slug: "primary",
				primary: true,
			});
			return;
		}

		const listResult = await pi.exec("git", ["worktree", "list", "--porcelain"], {
			cwd: project.path,
		});
		if (listResult.code !== 0) {
			ctx.ui.notify("Failed to list git worktrees", "error");
			return;
		}

		const worktreeList = parseWorktreeList(listResult.stdout);
		const mainWorktree = worktreeList[0];
		const linked = worktreeList.slice(1);
		const { workstreams } = readRegistry();
		const projectRecords = workstreams.filter((r) => r.projectId === project.projectId);

		// No linked workstreams — guide user to create the first one
		if (linked.length === 0) {
			if (ctx.hasUI) {
				const choice = await ctx.ui.select(
					`${project.name} — No workstreams yet`,
					["Create first workstream…", "Open primary checkout", "Cancel"],
				);
				if (choice === "Create first workstream…") {
					const task =
						(await ctx.ui.input("New workstream task", "add oauth login"))?.trim() ?? "";
					if (!task) return;
					await doCreateWorkstream(
						ctx,
						project,
						mainWorktree?.path ?? project.path,
						task,
					);
				} else if (choice === "Open primary checkout") {
					await openPrimaryCheckout(ctx, project, mainWorktree);
				}
			} else {
				ctx.ui.notify(
					`No workstreams in ${project.name}. Run /projects new <task> to create one.`,
					"info",
				);
			}
			return;
		}

		// Exactly one linked workstream and no UI — open directly
		if (linked.length === 1 && !ctx.hasUI) {
			const wt = linked[0];
			await openWorkstream(
				ctx,
				wt,
				project,
				projectRecords.find((r) => samePath(r.worktreePath, wt.path)),
			);
			return;
		}

		// No UI with multiple workstreams — show text list
		if (!ctx.hasUI) {
			const lines = [
				`Workstreams for ${project.name}`,
				"",
				...linked.map((wt) => {
					const record = projectRecords.find((r) => samePath(r.worktreePath, wt.path));
					const task = deriveTaskFromWorktree(wt, record);
					return `- ${task} — ${wt.branch ?? wt.path}`;
				}),
				"",
				"Use /projects <project> with UI to open one, or /projects new <task> to create one.",
			];
			pi.sendMessage({
				customType: "workstream-list",
				content: [{ type: "text", text: lines.join("\n") }],
				display: "user",
			});
			return;
		}

		// Show interactive picker
		const selected = await selectWorkstream(ctx, project, worktreeList, projectRecords);
		if (!selected) return;

		if (selected === NEW_WORKSTREAM_ID) {
			const task =
				(await ctx.ui.input("New workstream task", "add oauth login"))?.trim() ?? "";
			if (!task) return;
			await doCreateWorkstream(ctx, project, mainWorktree?.path ?? project.path, task);
		} else if (selected === PRIMARY_ID) {
			await openPrimaryCheckout(ctx, project, mainWorktree);
		} else {
			const wt = worktreeList.find((w) => samePath(w.path, selected));
			if (!wt) return;
			await openWorkstream(
				ctx,
				wt,
				project,
				projectRecords.find((r) => samePath(r.worktreePath, selected)),
			);
		}
	}

	// ── /projects command ─────────────────────────────────────────────────────

	const projectsHandler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
		const query = args.trim();
		const allProjects = discoverProjects();

		if (allProjects.length === 0) {
			ctx.ui.notify("No project folders found", "warning");
			return;
		}

		// /projects list
		if (query === "list" || query === "ls") {
			sendProjectsList(allProjects);
			return;
		}

		// /projects new [task]
		if (query === "new" || query.startsWith("new ")) {
			const taskFromArgs = query === "new" ? "" : query.slice(4).trim();
			let task = taskFromArgs;

			if (!task) {
				if (ctx.hasUI) {
					task = (await ctx.ui.input("New workstream task", "add oauth login"))?.trim() ?? "";
				}
				if (!task) {
					ctx.ui.notify("Usage: /projects new <task>", "warning");
					return;
				}
			}

			const mainRoot = await resolveMainRoot(ctx.cwd);
			if (!mainRoot) {
				ctx.ui.notify("/projects new requires a git repository", "error");
				return;
			}

			const project = projectInfoForPath(mainRoot);
			await doCreateWorkstream(ctx, project, mainRoot, task);
			return;
		}

		// /projects with no args — show project picker
		if (!query) {
			if (!ctx.hasUI) {
				sendProjectsList(allProjects);
				return;
			}
			const project = await selectProject(ctx, allProjects);
			if (!project) return;
			await openProjectWorkstreams(ctx, project);
			return;
		}

		// /projects <query> — search and open
		const matches = findProjects(allProjects, query);
		if (matches.length === 0) {
			ctx.ui.notify("No matching project found", "error");
			return;
		}

		let project: ProjectInfo;
		if (matches.length === 1 || !ctx.hasUI) {
			project = matches[0];
		} else {
			const picked = await selectProject(ctx, matches, "Matching projects");
			if (!picked) return;
			project = picked;
		}

		await openProjectWorkstreams(ctx, project);
	};

	pi.registerCommand("projects", {
		description:
			"Open a project and manage its workstreams · /projects [query] · /projects new [task] · /projects list",
		getArgumentCompletions: (prefix) => {
			const clean = prefix.trim();
			const builtins = ["list", "new"].filter((c) => c.startsWith(clean.toLowerCase()));
			const projectMatches = clean ? findProjects(discoverProjects(), clean) : discoverProjects();
			return [
				...builtins.map((v) => ({ value: v, label: v })),
				...projectMatches.map((p) => ({ value: p.label, label: p.label })),
			].slice(0, 25);
		},
		handler: projectsHandler,
	});

	// ── /ws command ───────────────────────────────────────────────────────────

	// -- Safety helpers (ported from worktree.ts) --

	async function isDirty(worktreePath: string): Promise<boolean> {
		const result = await pi.exec("git", ["status", "--porcelain"], { cwd: worktreePath });
		return result.code === 0 && result.stdout.trim().length > 0;
	}

	async function originRefForBranch(mainWorktree: string, branch: string): Promise<string | null> {
		const upstream = await pi.exec(
			"git",
			["rev-parse", "--abbrev-ref", `${branch}@{upstream}`],
			{ cwd: mainWorktree },
		);
		const upstreamRef = upstream.stdout.trim();
		if (upstream.code === 0 && upstreamRef.startsWith("origin/")) return upstreamRef;

		const originRef = `origin/${branch}`;
		const check = await pi.exec(
			"git", ["rev-parse", "--verify", "--quiet", originRef],
			{ cwd: mainWorktree },
		);
		return check.code === 0 ? originRef : null;
	}

	async function localMainRef(mainWorktree: string): Promise<string | null> {
		for (const candidate of ["main", "master"]) {
			const check = await pi.exec(
				"git", ["rev-parse", "--verify", "--quiet", candidate],
				{ cwd: mainWorktree },
			);
			if (check.code === 0) return candidate;
		}
		return null;
	}

	async function compareBranchWithRef(
		mainWorktree: string,
		branch: string,
		ref: string,
	): Promise<{ safe: boolean; reason: string }> {
		const counts = await pi.exec(
			"git", ["rev-list", "--left-right", "--count", `${ref}...${branch}`],
			{ cwd: mainWorktree },
		);
		const [behindRaw, aheadRaw] = counts.stdout.trim().split(/\s+/);
		const behind = Number(behindRaw ?? 0);
		const ahead = Number(aheadRaw ?? 0);
		if (counts.code === 0 && behind === 0 && ahead === 0) {
			return { safe: true, reason: `branch matches ${ref}` };
		}
		const parts: string[] = [];
		if (ahead > 0) parts.push(`${ahead} commit${ahead === 1 ? "" : "s"} ahead of ${ref}`);
		if (behind > 0) parts.push(`${behind} commit${behind === 1 ? "" : "s"} behind ${ref}`);
		return { safe: false, reason: parts.join(" and ") || `could not compare with ${ref}` };
	}

	async function branchIsSafelyDeletable(
		mainWorktree: string,
		branch: string,
		dirty: boolean,
	): Promise<{ safe: boolean; reason: string }> {
		if (dirty) return { safe: false, reason: "the worktree has uncommitted changes" };
		const originRef = await originRefForBranch(mainWorktree, branch);
		if (originRef) return compareBranchWithRef(mainWorktree, branch, originRef);
		const baseRef = await localMainRef(mainWorktree);
		if (baseRef) return compareBranchWithRef(mainWorktree, branch, baseRef);
		return {
			safe: false,
			reason: "no origin tracking branch and no local main/master to compare against",
		};
	}

	async function deleteLocalBranch(mainWorktree: string, branch: string): Promise<string | null> {
		const result = await pi.exec("git", ["branch", "-D", branch], { cwd: mainWorktree });
		if (result.code === 0) return null;
		return result.stderr.trim() || result.stdout.trim() || "git branch -D failed";
	}

	// -- Workstream view building --

	/** Join live worktrees with registry records into WorkstreamViews. */
	async function buildWorkstreamViews(
		mainRoot: string,
		project: ProjectInfo,
		worktreeList: WorktreeInfo[],
		registryRecords: WorkstreamRecord[],
		currentRoot: string,
	): Promise<WorkstreamView[]> {
		const views: WorkstreamView[] = [];

		for (const wt of worktreeList) {
			const primary = samePath(wt.path, mainRoot);
			let record = registryRecords.find((r) => samePath(r.worktreePath, wt.path));

			// Backfill registry for unregistered linked worktrees
			if (!primary && !record) {
				const slug = path.basename(wt.path);
				const branch = wt.branch ?? "";
				const task = deriveTaskFromWorktree(wt);
				const now = new Date().toISOString();
				const backfilled: WorkstreamRecord = {
					id: workstreamId(project.projectId, slug),
					projectId: project.projectId,
					projectName: project.name,
					projectPath: project.path,
					projectRemoteUrl: project.remoteUrl,
					task,
					slug,
					branch,
					worktreePath: wt.path,
					primary: false,
					createdAt: now,
					updatedAt: now,
				};
				upsertWorkstream(backfilled);
				record = backfilled;
			}

			const task = primary ? "Primary checkout" : deriveTaskFromWorktree(wt, record);
			const slug = record?.slug ?? path.basename(wt.path);
			const branch = record?.branch ?? wt.branch ?? "";

			let active = false;
			if (isCmux()) {
				try {
					active = (await findWorkspaceForPath(pi, wt.path)) !== undefined;
				} catch {
					// ignore — cmux may be temporarily unavailable
				}
			}

			views.push({
				record,
				worktree: wt,
				project,
				task,
				slug,
				branch,
				worktreePath: wt.path,
				primary,
				current: samePath(wt.path, currentRoot),
				active,
			});
		}

		// Include orphaned registry records (worktree no longer in live list)
		for (const record of registryRecords) {
			const inLive = worktreeList.some((wt) => samePath(wt.path, record.worktreePath));
			if (inLive) continue;
			views.push({
				record,
				project,
				task: record.task,
				slug: record.slug,
				branch: record.branch,
				worktreePath: record.worktreePath,
				primary: record.primary,
				current: false,
				active: false,
			});
		}

		return views;
	}

	/** Build WorkstreamViews from registry records alone (no live git context). */
	function buildRegistryViews(workstreams: WorkstreamRecord[]): WorkstreamView[] {
		return workstreams.map((record) => {
			const project: ProjectInfo = {
				name: record.projectName,
				label: record.projectName,
				path: record.projectPath,
				remoteUrl: record.projectRemoteUrl,
				projectId: record.projectId,
			};
			return {
				record,
				project,
				task: record.task,
				slug: record.slug,
				branch: record.branch,
				worktreePath: record.worktreePath,
				primary: record.primary,
				current: false,
				active: false,
			};
		});
	}

	function workstreamDisplayName(view: WorkstreamView): string {
		return view.primary ? "Primary checkout" : view.task;
	}

	function workstreamStateLabels(view: WorkstreamView, opts: { includePaused?: boolean } = {}): string[] {
		const labels: string[] = [];
		if (view.current) labels.push("current Pi");
		if (view.active) labels.push("open in cmux");
		else if (opts.includePaused) labels.push("not open");
		if (view.primary) labels.push("non-removable");
		if (view.worktree?.locked) labels.push("git locked");
		if (view.worktree?.prunable) labels.push("git prunable");
		if (!view.worktree) labels.push("missing checkout");
		return labels;
	}

	/** Format a picker label: `project · name — branch: branch (state)`. */
	function workstreamPickerLabel(view: WorkstreamView): string {
		const labels = workstreamStateLabels(view);
		const suffix = labels.length > 0 ? ` (${labels.join(", ")})` : "";
		return `${view.project.name} · ${workstreamDisplayName(view)} — branch: ${view.branch || "none"}${suffix}`;
	}

	/** Find a view by slug, task, branch, basename, or full path. */
	function findViewByName(views: WorkstreamView[], name: string): WorkstreamView | undefined {
		const clean = name.trim();
		if (!clean) return undefined;
		return (
			views.find((v) => v.slug === clean) ??
			views.find((v) => v.task.toLowerCase() === clean.toLowerCase()) ??
			views.find((v) => v.branch === clean || v.branch === `wt/${clean}`) ??
			views.find((v) => path.basename(v.worktreePath) === clean) ??
			views.find((v) => samePath(v.worktreePath, clean))
		);
	}

	// -- Workstream removal --

	/**
	 * Remove a workstream: git worktree remove, optional branch delete, registry cleanup.
	 * Returns true on success.
	 */
	async function doRemoveWorkstream(
		ctx: ExtensionCommandContext,
		view: WorkstreamView,
		mainRoot: string,
		allWorktrees: WorktreeInfo[],
		opts: { force: boolean; yes: boolean },
	): Promise<boolean> {
		if (view.primary) {
			ctx.ui.notify("Cannot remove the primary checkout", "error");
			return false;
		}

		// No live worktree — prune registry entry only
		if (!view.worktree) {
			if (view.record) removeWorkstream(view.record.id);
			ctx.ui.notify(`Removed registry entry: ${view.task}`, "info");
			return true;
		}

		const dirty = await isDirty(view.worktreePath);
		const forceRemove = opts.force || dirty;

		let deleteBranch = false;
		if (view.branch) {
			const safety = await branchIsSafelyDeletable(mainRoot, view.branch, dirty);
			deleteBranch = safety.safe;

			if (!deleteBranch && ctx.hasUI && !opts.yes) {
				deleteBranch = await ctx.ui.confirm(
					"Delete branch too?",
					[
						`Branch is not automatically safe to delete: ${safety.reason}.`,
						`Branch: \`${view.branch}\``,
						"Force-delete this local branch after removing the worktree?",
					].join("\n\n"),
				);
			}
		}

		const removeResult = await pi.exec(
			"git",
			["worktree", "remove", ...(forceRemove ? ["--force"] : []), view.worktreePath],
			{ cwd: mainRoot },
		);
		if (removeResult.code !== 0) {
			const reason =
				removeResult.stderr.trim() || removeResult.stdout.trim() || "git worktree remove failed";
			ctx.ui.notify(reason, "error");
			return false;
		}

		if (view.record) removeWorkstream(view.record.id);

		let summary = `Removed workstream: ${view.task}`;
		if (view.branch) {
			if (deleteBranch) {
				const branchError = await deleteLocalBranch(mainRoot, view.branch);
				summary += branchError
					? `; branch kept (${branchError})`
					: `; deleted branch: ${view.branch}`;
			} else {
				summary += `; kept branch: ${view.branch}`;
			}
		}
		ctx.ui.notify(summary, "info");
		return true;
	}

	// -- Text list --

	function sendWorkstreamList(views: WorkstreamView[]): void {
		if (views.length === 0) {
			pi.sendMessage({
				customType: "ws-list",
				content: [
					{
						type: "text",
						text: "No workstreams found.\n\nUse `/projects new <task>` to create one.",
					},
				],
				display: "user",
			});
			return;
		}

		const lines: string[] = ["Workstreams", ""];

		const byProject = new Map<string, WorkstreamView[]>();
		for (const v of views) {
			const key = v.project.name;
			if (!byProject.has(key)) byProject.set(key, []);
			byProject.get(key)!.push(v);
		}

		for (const [projectName, projectViews] of byProject) {
			if (byProject.size > 1) lines.push(`**${projectName}**`, "");
			for (const v of projectViews) {
				const labels = workstreamStateLabels(v, { includePaused: true });
				const suffix = labels.length > 0 ? ` (${labels.join(", ")})` : "";
				const pathStr = v.worktree ? v.worktreePath : `${v.worktreePath} (missing)`;
				lines.push(`- **${workstreamDisplayName(v)}**${suffix}`);
				lines.push(`  Branch: \`${v.branch || "none"}\``);
				lines.push(`  Path: ${pathStr}`);
			}
			lines.push("");
		}

		lines.push(
			"Usage: `/ws` to pick/open · `/ws remove <name>` to remove · `/ws delete` to remove current · `/ws fork [name]` to fork WIP",
		);

		pi.sendMessage({
			customType: "ws-list",
			content: [{ type: "text", text: lines.join("\n") }],
			display: "user",
		});
	}

	// -- Interactive picker --

	async function wsInteractivePicker(
		ctx: ExtensionCommandContext,
		views: WorkstreamView[],
		mainRoot: string | null,
		allWorktrees: WorktreeInfo[],
	): Promise<void> {
		if (views.length === 0) {
			ctx.ui.notify("No workstreams found", "info");
			return;
		}

		const deduped = new Map<string, WorkstreamView>();
		for (const v of views) {
			let label = workstreamPickerLabel(v);
			while (deduped.has(label)) label += " ";
			deduped.set(label, v);
		}

		const projectNames = [...new Set(views.map((v) => v.project.name))];
		const title =
			projectNames.length === 1
				? `Workstreams — ${projectNames[0]}`
				: `Workstreams (${views.length})`;

		const selected = await ctx.ui.select(title, [...deduped.keys()]);
		if (!selected) return;

		const view = deduped.get(selected);
		if (!view) return;

		const actionOptions: string[] = ["Open / switch Pi conversation"];
		if (!view.primary) actionOptions.push("Remove workstream");

		const action = await ctx.ui.select(view.task, actionOptions);
		if (action === "Open / switch Pi conversation") {
			await openOrSwitchWorkspace(pi, ctx, {
				worktreePath: view.worktreePath,
				projectName: view.project.name,
				task: view.task,
				slug: view.slug,
				primary: view.primary,
			});
		} else if (action === "Remove workstream" && mainRoot) {
			await doRemoveWorkstream(ctx, view, mainRoot, allWorktrees, { force: false, yes: false });
		}
	}

	// -- Fork workstream --

	/**
	 * Fork the current workstream: create a new worktree from HEAD, copy WIP
	 * (tracked diff + untracked files) into it, register it, and launch in cmux.
	 */
	async function doForkWorkstream(
		ctx: ExtensionCommandContext,
		project: ProjectInfo,
		mainRoot: string,
		currentRoot: string,
		sourceRecord: WorkstreamRecord | undefined,
		forkName: string,
		noWip: boolean,
	): Promise<void> {
		// Capture source HEAD commit and branch name
		const headResult = await pi.exec("git", ["rev-parse", "HEAD"], { cwd: currentRoot });
		if (headResult.code !== 0) {
			ctx.ui.notify("Failed to resolve HEAD in current worktree", "error");
			return;
		}
		const sourceHead = headResult.stdout.trim();

		const branchRes = await pi.exec(
			"git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: currentRoot },
		);
		const sourceBranch =
			branchRes.code === 0 && branchRes.stdout.trim() !== "HEAD"
				? branchRes.stdout.trim()
				: sourceRecord?.branch ?? path.basename(currentRoot);

		// Generate unique target (slug/branch/path with collision suffix)
		const { slug, branchName, worktreePath } = getUniqueWorkstreamTarget(mainRoot, forkName);

		// Capture WIP unless --no-wip
		let patchFile: string | undefined;
		let untrackedFiles: string[] = [];

		if (!noWip) {
			// Tracked diff (--binary for binary file support)
			const diffResult = await pi.exec(
				"git", ["diff", "--binary", "HEAD", "--"], { cwd: currentRoot },
			);
			if (diffResult.stdout.trim().length > 0) {
				patchFile = path.join(os.tmpdir(), `ws-fork-${slug}-${Date.now()}.patch`);
				try {
					fs.writeFileSync(patchFile, diffResult.stdout, "utf8");
				} catch (err) {
					ctx.ui.notify(
						`Failed to write patch file: ${err instanceof Error ? err.message : String(err)}`,
						"error",
					);
					return;
				}
			}

			// NUL-delimited list of untracked, non-ignored files
			const untrackedResult = await pi.exec(
				"git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: currentRoot },
			);
			if (untrackedResult.code === 0) {
				untrackedFiles = untrackedResult.stdout
					.split("\0")
					.map((f) => f.trim())
					.filter(Boolean);
			}
		}

		// Create fork worktree at source HEAD
		const addResult = await pi.exec(
			"git",
			["worktree", "add", "-b", branchName, worktreePath, sourceHead],
			{ cwd: mainRoot },
		);
		if (addResult.code !== 0) {
			const reason =
				addResult.stderr.trim() || addResult.stdout.trim() || "git worktree add failed";
			if (patchFile) { try { fs.unlinkSync(patchFile); } catch { /* ignore */ } }
			ctx.ui.notify(reason, "error");
			return;
		}

		// Apply tracked diff to the fork
		let patchApplied = false;
		if (patchFile) {
			const applyResult = await pi.exec(
				"git", ["apply", "--binary", patchFile], { cwd: worktreePath },
			);
			try { fs.unlinkSync(patchFile); } catch { /* ignore */ }
			patchFile = undefined;

			if (applyResult.code !== 0) {
				const reason =
					applyResult.stderr.trim() || applyResult.stdout.trim() || "git apply failed";
				await pi.exec("git", ["worktree", "remove", "--force", worktreePath], { cwd: mainRoot });
				ctx.ui.notify(`Fork failed while applying WIP: ${reason}`, "error");
				return;
			}
			patchApplied = true;
		}

		// Copy untracked files into the fork, preserving relative paths
		let untrackedCopied = 0;
		if (untrackedFiles.length > 0) {
			const copyErrors: string[] = [];
			for (const rel of untrackedFiles) {
				const src = path.join(currentRoot, rel);
				const dest = path.join(worktreePath, rel);
				try {
					fs.mkdirSync(path.dirname(dest), { recursive: true });
					let stat: fs.Stats;
					try { stat = fs.statSync(src); } catch { continue; } // file disappeared — skip
					if (stat.isDirectory()) {
						// fs.cpSync available since Node 16.7; fall back gracefully
						if (typeof fs.cpSync === "function") {
							fs.cpSync(src, dest, { recursive: true });
						} else {
							copyErrors.push(`${rel}: directory copy unavailable (Node <16.7)`);
							continue;
						}
					} else {
						fs.copyFileSync(src, dest);
					}
					untrackedCopied++;
				} catch (err) {
					copyErrors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}

			if (copyErrors.length > 0) {
				await pi.exec("git", ["worktree", "remove", "--force", worktreePath], { cwd: mainRoot });
				ctx.ui.notify(
					`Fork failed while copying untracked files:\n${copyErrors.slice(0, 5).join("\n")}`,
					"error",
				);
				return;
			}
		}

		// Write .pi/session-name so future sessions auto-name themselves
		try { writeSessionName(worktreePath, forkName); } catch { /* non-fatal */ }

		// Upsert registry record
		const now = new Date().toISOString();
		const record: WorkstreamRecord = {
			id: workstreamId(project.projectId, slug),
			projectId: project.projectId,
			projectName: project.name,
			projectPath: project.path,
			projectRemoteUrl: project.remoteUrl,
			task: forkName,
			slug,
			branch: branchName,
			worktreePath,
			primary: false,
			...(sourceRecord ? { forkOf: sourceRecord.id } : {}),
			createdAt: now,
			updatedAt: now,
		};
		upsertWorkstream(record);

		// Launch fork in cmux
		let launchLine = "cmux not available — open manually";
		if (isCmux()) {
			const result = await launchPiWorkspace(pi, {
				worktreePath,
				projectName: project.name,
				task: forkName,
				slug,
				primary: false,
			});
			launchLine = result.launched
				? `Launched: ${result.workspaceTitle ?? slug}`
				: result.error
					? `Launch failed: ${result.error}`
					: "Launch skipped";
		}

		// Build summary
		const wipLines: string[] = noWip
			? ["- WIP: skipped (--no-wip)"]
			: [
					patchApplied
						? "- WIP: tracked diff applied"
						: "- WIP: no tracked changes (clean source)",
					`- Untracked files copied: ${untrackedCopied}`,
			  ];

		const message = [
			"🍴 Workstream forked",
			"",
			`- Source: \`${sourceBranch}\` → ${currentRoot}`,
			`- Fork: \`${branchName}\` → ${worktreePath}`,
			...wipLines,
			`- ${launchLine}`,
		].join("\n");

		pi.sendMessage({
			customType: "workstream-forked",
			content: [{ type: "text", text: message }],
			display: "user",
		});

		ctx.ui.notify(`Workstream forked: ${forkName}`, "info");
	}

	// -- /ws handler --

	const wsHandler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
		const tokens = args.trim().split(/\s+/).filter(Boolean);
		const sub = tokens[0] ?? "";
		const rest = tokens.slice(1);
		const force = rest.includes("--force") || rest.includes("-f");
		const yes = rest.includes("--yes") || rest.includes("-y");
		const nameTokens = rest.filter((t) => !t.startsWith("-"));
		const targetName = nameTokens.join(" ");

		// Unknown subcommand — warn with usage; do not create workstreams from /ws
		const knownSubs = new Set(["list", "ls", "remove", "rm", "delete", "fork", ""]);
		if (!knownSubs.has(sub)) {
			const usage = [
				`Unknown subcommand: \`${sub}\`. Use one of:`,
				"- `/ws` — pick and open a workstream",
				"- `/ws list` — list workstreams",
				"- `/ws remove [name]` — remove a workstream",
				"- `/ws delete` — remove current linked workstream",
				"- `/ws fork [name]` — fork current WIP into a new workstream",
				"",
				"To create a workstream, use `/projects new <task>`.",
			].join("\n");
			if (ctx.hasUI) {
				ctx.ui.notify(`Unknown subcommand: ${sub}`, "warning");
			} else {
				pi.sendMessage({
					customType: "ws-usage",
					content: [{ type: "text", text: usage }],
					display: "user",
				});
			}
			return;
		}

		// Resolve git context for the current cwd
		const currentRootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
			cwd: ctx.cwd,
		});
		const currentRoot = currentRootResult.code === 0 ? currentRootResult.stdout.trim() : null;

		let mainRoot: string | null = null;
		let worktreeList: WorktreeInfo[] = [];
		let project: ProjectInfo | null = null;

		if (currentRoot) {
			const listResult = await pi.exec("git", ["worktree", "list", "--porcelain"], {
				cwd: currentRoot,
			});
			if (listResult.code === 0) {
				worktreeList = parseWorktreeList(listResult.stdout);
				mainRoot = worktreeList[0]?.path ?? currentRoot;
			} else {
				mainRoot = currentRoot;
			}
			project = projectInfoForPath(mainRoot);
		}

		// /ws list
		if (sub === "list" || sub === "ls") {
			if (mainRoot && project) {
				const { workstreams } = readRegistry();
				const records = workstreams.filter((r) => r.projectId === project!.projectId);
				const views = await buildWorkstreamViews(
					mainRoot, project, worktreeList, records, currentRoot ?? ctx.cwd,
				);
				sendWorkstreamList(views);
			} else {
				const { workstreams } = readRegistry();
				sendWorkstreamList(buildRegistryViews(workstreams));
			}
			return;
		}

		// /ws remove [name]
		if (sub === "remove" || sub === "rm") {
			if (!mainRoot || !project) {
				ctx.ui.notify("/ws remove requires a git repository", "error");
				return;
			}
			const { workstreams } = readRegistry();
			const records = workstreams.filter((r) => r.projectId === project!.projectId);
			const views = await buildWorkstreamViews(
				mainRoot, project, worktreeList, records, currentRoot ?? ctx.cwd,
			);

			let target: WorkstreamView | undefined;
			if (targetName) {
				target = findViewByName(views, targetName);
				if (!target) {
					ctx.ui.notify(`No workstream found matching: ${targetName}`, "error");
					return;
				}
			} else if (ctx.hasUI) {
				const removable = views.filter((v) => !v.primary && v.worktree);
				if (removable.length === 0) {
					ctx.ui.notify("No linked workstreams available to remove", "info");
					return;
				}
				const choices = removable.map((v) => workstreamPickerLabel(v));
				const choice = await ctx.ui.select("Remove workstream", choices);
				if (!choice) return;
				target = removable[choices.indexOf(choice)];
			} else {
				ctx.ui.notify("Usage: /ws remove <name>", "warning");
				return;
			}

			if (!target) return;
			if (target.primary) {
				ctx.ui.notify("Cannot remove the primary checkout", "error");
				return;
			}
			await doRemoveWorkstream(ctx, target, mainRoot, worktreeList, { force, yes });
			return;
		}

		// /ws delete
		if (sub === "delete") {
			if (!currentRoot || !mainRoot || !project) {
				ctx.ui.notify("/ws delete requires a git repository", "error");
				return;
			}
			const { workstreams } = readRegistry();
			const records = workstreams.filter((r) => r.projectId === project!.projectId);
			const views = await buildWorkstreamViews(mainRoot, project, worktreeList, records, currentRoot);

			const current = views.find((v) => v.current);
			if (!current || current.primary) {
				ctx.ui.notify("/ws delete only works from inside a linked workstream", "error");
				return;
			}

			try {
				process.chdir(os.homedir());
			} catch {
				// best-effort; ignore
			}
			const success = await doRemoveWorkstream(
				ctx, current, mainRoot, worktreeList, { force, yes },
			);
			if (success) ctx.shutdown();
			return;
		}

		// /ws fork [name]
		if (sub === "fork") {
			if (!currentRoot || !mainRoot || !project) {
				ctx.ui.notify("/ws fork requires a git repository", "error");
				return;
			}

			const noWip = rest.includes("--no-wip");

			// Warn about explicitly deferred flags
			const unsupportedForkFlags = rest.filter(
				(t) => t === "--temp" || t === "--include-ignored",
			);
			if (unsupportedForkFlags.length > 0) {
				ctx.ui.notify(
					`Unsupported flag(s): ${unsupportedForkFlags.join(", ")}. Not implemented; ignored.`,
					"warning",
				);
			}

			const { workstreams: wsReg } = readRegistry();
			const sourceRecord = findByWorktreePath(currentRoot, wsReg) ?? undefined;

			// Resolve fork name: inline arg → UI prompt → auto-generated
			let forkName = targetName;
			if (!forkName) {
				const sourceName = sourceRecord?.task ?? path.basename(currentRoot);
				if (ctx.hasUI) {
					forkName =
						(await ctx.ui.input("Fork name", `${sourceName}-fork`))?.trim() ?? "";
				}
				if (!forkName) {
					// Auto-generate from source task/branch + short timestamp suffix
					const suffix = Date.now().toString().slice(-5);
					forkName = `${sourceName}-fork-${suffix}`;
				}
			}

			await doForkWorkstream(
				ctx, project, mainRoot, currentRoot, sourceRecord, forkName, noWip,
			);
			return;
		}

		// /ws with no args — interactive picker or text list
		if (mainRoot && project) {
			const { workstreams } = readRegistry();
			const records = workstreams.filter((r) => r.projectId === project!.projectId);
			const views = await buildWorkstreamViews(
				mainRoot, project, worktreeList, records, currentRoot ?? ctx.cwd,
			);
			if (ctx.hasUI) {
				await wsInteractivePicker(ctx, views, mainRoot, worktreeList);
			} else {
				sendWorkstreamList(views);
			}
		} else {
			const { workstreams } = readRegistry();
			const views = buildRegistryViews(workstreams);
			if (ctx.hasUI && views.length > 0) {
				await wsInteractivePicker(ctx, views, null, []);
			} else {
				sendWorkstreamList(views);
			}
		}
	};

	pi.registerCommand("ws", {
		description:
			"Manage workstreams · /ws list · /ws remove [name] · /ws delete · /ws fork [name]",
		getArgumentCompletions: (prefix) => {
			const clean = prefix.trim();
			return ["list", "remove", "delete", "fork"]
				.filter((c) => c.startsWith(clean.toLowerCase()))
				.map((v) => ({ value: v, label: v }));
		},
		handler: wsHandler,
	});
}
