/**
 * Shared cmux launch/switch helpers.
 *
 * Utilities for interacting with cmux workspaces: creating, finding, grouping,
 * and switching to workspaces that run Pi sessions.
 *
 * Path helpers (realPath, pathContains) are duplicated locally. If
 * lib/workstreams.ts is added later, callers may prefer to import from there.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Basic utilities
// ---------------------------------------------------------------------------

export function shellQuote(value: string): string {
	return "'" + value.replace(/'/g, "'\\''") + "'";
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isCmux(): boolean {
	if (process.env.CMUX_WORKSPACE_ID) return true;
	try {
		const sockPath =
			process.env.CMUX_SOCKET_PATH ??
			`${process.env.HOME}/Library/Application Support/cmux/cmux.sock`;
		fs.accessSync(sockPath);
		return true;
	} catch {
		return false;
	}
}

export function extractWorkspaceRef(output: string): string | null {
	const match = output.match(/workspace:(\S+)/);
	return match ? `workspace:${match[1]}` : null;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function realPath(value: string): string {
	const resolved = path.resolve(value);
	try {
		return fs.realpathSync.native(resolved);
	} catch {
		const missingParts: string[] = [];
		for (let current = resolved; ; current = path.dirname(current)) {
			if (fs.existsSync(current)) {
				try {
					return path.join(fs.realpathSync.native(current), ...missingParts);
				} catch {
					return resolved;
				}
			}
			const parent = path.dirname(current);
			if (parent === current) return resolved;
			missingParts.unshift(path.basename(current));
		}
	}
}

function pathContains(root: string, candidate: string): boolean {
	const roots = new Set([realPath(root), path.resolve(root)]);
	const candidates = new Set([realPath(candidate), path.resolve(candidate)]);
	for (const rootPath of roots) {
		for (const candidatePath of candidates) {
			if (candidatePath === rootPath || candidatePath.startsWith(rootPath + path.sep)) return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CmuxWorkspaceGroup = {
	id?: string;
	ref?: string;
	group_ref?: string;
	workspace_group_ref?: string;
	name?: string;
	title?: string;
	label?: string;
	display_name?: string;
};

export type CmuxWorkspaceTarget = { id?: string; ref?: string };

/**
 * Minimal workstream shape required by openOrSwitchWorkspace.
 * Compatible with the full Workstream type from lib/workstreams.ts.
 */
export interface WorkstreamRef {
	worktreePath: string;
	projectName: string;
	task: string;
	slug: string;
	primary?: boolean;
}

export interface LaunchPiWorkspaceOptions {
	worktreePath: string;
	projectName: string;
	task: string;
	slug: string;
	primary?: boolean;
}

export interface LaunchPiWorkspaceResult {
	launched: boolean;
	workspaceRef?: string;
	workspaceTitle?: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Workspace group helpers
// ---------------------------------------------------------------------------

export function cmuxWorkspaceGroupRef(group: CmuxWorkspaceGroup): string | undefined {
	return group.ref ?? group.group_ref ?? group.workspace_group_ref ?? group.id;
}

export function cmuxWorkspaceGroupName(group: CmuxWorkspaceGroup): string | undefined {
	return group.name ?? group.title ?? group.label ?? group.display_name;
}

export function parseCmuxWorkspaceGroup(output: string): CmuxWorkspaceGroup | undefined {
	const trimmed = output.trim();
	if (!trimmed) return undefined;
	try {
		const parsed = JSON.parse(trimmed) as
			| CmuxWorkspaceGroup
			| { group?: CmuxWorkspaceGroup; groups?: CmuxWorkspaceGroup[] };
		if ("group" in parsed && parsed.group) return parsed.group;
		if ("groups" in parsed && parsed.groups?.[0]) return parsed.groups[0];
		return parsed as CmuxWorkspaceGroup;
	} catch {
		const match = trimmed.match(/workspace_group:\S+/);
		return match ? { ref: match[0] } : undefined;
	}
}

export async function listWorkspaceGroups(pi: ExtensionAPI): Promise<CmuxWorkspaceGroup[]> {
	const result = await pi.exec("cmux", ["workspace-group", "list", "--json"]);
	if (result.code !== 0 || !result.stdout.trim()) return [];
	try {
		const parsed = JSON.parse(result.stdout) as { groups?: CmuxWorkspaceGroup[] };
		return parsed.groups ?? [];
	} catch {
		return [];
	}
}

export async function findWorkspaceGroupByName(
	pi: ExtensionAPI,
	name: string,
): Promise<CmuxWorkspaceGroup | undefined> {
	const groups = await listWorkspaceGroups(pi);
	return groups.find((group) => cmuxWorkspaceGroupName(group) === name);
}

/**
 * Find an existing workspace group for the given project name.
 *
 * Do not create a group here: `cmux workspace-group create` defaults to the
 * active workspace when `--from` is omitted, which can attach a new Project to
 * the caller's current group. Create groups from a known workspace ref instead.
 */
export async function ensureWorkspaceGroup(
	pi: ExtensionAPI,
	projectName: string,
): Promise<string | undefined> {
	if (!isCmux()) return undefined;
	const existing = await findWorkspaceGroupByName(pi, projectName);
	return existing ? cmuxWorkspaceGroupRef(existing) : undefined;
}

// ---------------------------------------------------------------------------
// Workspace finder
// ---------------------------------------------------------------------------

/**
 * Find an existing cmux workspace whose paths include workstreamPath.
 * Returns undefined when not in cmux or no match is found.
 */
export async function findWorkspaceForPath(
	pi: ExtensionAPI,
	workstreamPath: string,
): Promise<CmuxWorkspaceTarget | undefined> {
	if (!isCmux()) return undefined;

	const snapshot = await pi.exec("cmux", ["rpc", "extension.sidebar.snapshot", "{}"]);
	if (snapshot.code !== 0 || !snapshot.stdout.trim()) return undefined;

	try {
		const parsed = JSON.parse(snapshot.stdout) as {
			workspaces?: Array<{
				id?: string;
				ref?: string;
				current_directory?: string;
				project_root_path?: string;
				root_path?: string;
				panel_directories?: string[];
			}>;
		};
		for (const workspace of parsed.workspaces ?? []) {
			const paths = [
				workspace.project_root_path,
				workspace.current_directory,
				workspace.root_path,
				...(workspace.panel_directories ?? []),
			].filter((value): value is string => Boolean(value));
			if (
				(workspace.id || workspace.ref) &&
				paths.some((candidate) => pathContains(workstreamPath, candidate))
			) {
				return { id: workspace.id, ref: workspace.ref };
			}
		}
	} catch {}
	return undefined;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Build the shell command that launches a Pi conversation for the given task. */
export function formatPiCommand(task: string): string {
	return `PI_SESSION_NAME=${shellQuote(task)} pi`;
}

/**
 * Human-readable cmux workspace title.
 * Primary workstream: `<project> · primary`
 * Linked workstream:  `<project> · <slug/name>`
 */
export function workspaceTitle(
	projectName: string,
	slugOrName: string,
	primary?: boolean,
): string {
	return primary ? `${projectName} · primary` : `${projectName} · ${slugOrName}`;
}

// ---------------------------------------------------------------------------
// Launch / switch
// ---------------------------------------------------------------------------

/**
 * Create a new cmux workspace for a Workstream Pi conversation.
 *
 * - Runs `PI_SESSION_NAME=<task> pi` in worktreePath.
 * - Adds the workspace to an existing Project group when present.
 * - Creates a new Project group from the new workspace when needed.
 * - Renames and selects after a short settle delay.
 */
export async function launchPiWorkspace(
	pi: ExtensionAPI,
	options: LaunchPiWorkspaceOptions,
): Promise<LaunchPiWorkspaceResult> {
	if (!isCmux()) return { launched: false };

	const { worktreePath, projectName, task, slug, primary } = options;
	const piCommand = formatPiCommand(task);
	const existingGroup = await findWorkspaceGroupByName(pi, projectName);
	const groupRef = existingGroup ? cmuxWorkspaceGroupRef(existingGroup) : undefined;

	const createArgs = [
		"new-workspace",
		"--cwd",
		worktreePath,
		"--command",
		piCommand,
		"--focus",
		"true",
	];
	if (groupRef) {
		// Do not pass the current workspace as --group-reference here. If the
		// caller is in another project's group, cmux can place the new workspace
		// under that current group instead of the requested Project group.
		createArgs.push("--group", groupRef, "--group-placement", "end");
	}

	const createResult = await pi.exec("cmux", createArgs);
	if (createResult.code !== 0) {
		return {
			launched: false,
			error:
				createResult.stderr.trim() ||
				createResult.stdout.trim() ||
				"failed to create cmux workspace",
		};
	}

	const workspaceRef =
		extractWorkspaceRef(createResult.stdout || createResult.stderr || "") ?? undefined;
	const title = workspaceTitle(projectName, slug, primary);

	if (workspaceRef) {
		if (!groupRef) {
			await pi.exec("cmux", [
				"workspace-group",
				"create",
				"--name",
				projectName,
				"--from",
				workspaceRef,
				"--json",
			]);
		}
		await sleep(200);
		await pi.exec("cmux", ["rename-workspace", "--workspace", workspaceRef, title]);
		await pi.exec("cmux", ["select-workspace", "--workspace", workspaceRef]);
	}

	return { launched: true, workspaceRef, workspaceTitle: title };
}

/**
 * Switch to an existing cmux workspace for the workstream, or launch a new one.
 * Notifies the user via ctx.ui.notify in both cases.
 */
export async function openOrSwitchWorkspace(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	workstream: WorkstreamRef,
): Promise<void> {
	if (!isCmux()) {
		ctx.ui.notify("Opening workspaces requires cmux", "error");
		return;
	}

	const existingWorkspace = await findWorkspaceForPath(pi, workstream.worktreePath);
	const existingRef = existingWorkspace?.ref ?? existingWorkspace?.id;

	if (existingRef) {
		const selectResult = await pi.exec("cmux", ["select-workspace", "--workspace", existingRef]);
		if (selectResult.code === 0) {
			ctx.ui.notify(`Switched to ${workstream.slug}`, "info");
		} else {
			const reason =
				selectResult.stderr.trim() || selectResult.stdout.trim() || "cmux select-workspace failed";
			ctx.ui.notify(reason, "error");
		}
		return;
	}

	const launchResult = await launchPiWorkspace(pi, {
		worktreePath: workstream.worktreePath,
		projectName: workstream.projectName,
		task: workstream.task,
		slug: workstream.slug,
		primary: workstream.primary,
	});

	if (launchResult.launched) {
		ctx.ui.notify(`Launched ${workstream.slug}`, "info");
	} else {
		ctx.ui.notify(launchResult.error ?? "Could not launch cmux workspace", "error");
	}
}
