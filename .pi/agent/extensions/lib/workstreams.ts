/**
 * Shared Workstream domain helpers.
 *
 * Pure Node.js module — no Pi API dependency. Provides types and helpers for
 * the Projects + Workstreams user model. Projects are parent repos/contexts;
 * Workstreams are focused task contexts backed by git worktrees, Pi conversations,
 * and optional cmux workspaces.
 *
 * Keep this module free of side effects at init time (no file I/O, no execs).
 */

import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProjectInfo {
	name: string;
	label: string;
	path: string;
	remoteUrl?: string;
	projectId: string;
}

export interface WorktreeInfo {
	path: string;
	head?: string;
	branch?: string;
	detached: boolean;
	bare: boolean;
	locked?: string;
	prunable?: string;
}

export interface WorkstreamRecord {
	id: string;
	projectId: string;
	projectName: string;
	projectPath: string;
	projectRemoteUrl?: string;
	task: string;
	slug: string;
	branch: string;
	worktreePath: string;
	primary: boolean;
	forkOf?: string;
	sessionFile?: string;
	cmuxWorkspaceRef?: string;
	createdAt: string; // ISO 8601
	updatedAt: string; // ISO 8601
}

export interface WorkstreamRegistry {
	workstreams: WorkstreamRecord[];
}

/** Computed view joining registry metadata with live worktree + cmux state. */
export interface WorkstreamView {
	record?: WorkstreamRecord;
	worktree?: WorktreeInfo;
	project: ProjectInfo;
	task: string;
	slug: string;
	branch: string;
	worktreePath: string;
	primary: boolean;
	/** True when this worktree is the active Pi cwd. */
	current?: boolean;
	/** True when a cmux workspace is open for this worktree. */
	active?: boolean;
}

// ── Path utilities ────────────────────────────────────────────────────────────

export function realPath(value: string): string {
	const resolved = path.resolve(value);
	try {
		return fs.realpathSync.native(resolved);
	} catch {
		// Walk up to find the deepest existing ancestor, resolve that, then re-append.
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

export function samePath(a: string, b: string): boolean {
	return realPath(a) === realPath(b);
}

export function pathContains(root: string, candidate: string): boolean {
	const roots = new Set([realPath(root), path.resolve(root)]);
	const candidates = new Set([realPath(candidate), path.resolve(candidate)]);
	for (const rootPath of roots) {
		for (const candidatePath of candidates) {
			if (candidatePath === rootPath || candidatePath.startsWith(rootPath + path.sep)) return true;
		}
	}
	return false;
}

// ── Slug ─────────────────────────────────────────────────────────────────────

export function slugify(input: string): string {
	const slug = input
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-")
		.slice(0, 48);
	return slug || "task";
}

// ── Project identity ──────────────────────────────────────────────────────────

/**
 * Stable canonical id for a project. Uses git remote origin URL when available
 * (repo identity regardless of checkout path), otherwise falls back to the
 * real filesystem path.
 */
export function projectIdFor(projectPath: string): string {
	try {
		const url = execFileSync("git", ["-C", realPath(projectPath), "remote", "get-url", "origin"], {
			encoding: "utf8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (url) return url;
	} catch {
		// no remote or not a git repo — fall through
	}
	return realPath(projectPath);
}

/** Derive full ProjectInfo for a filesystem path. Runs git for remote URL. */
export function projectInfoForPath(projectPath: string, label?: string): ProjectInfo {
	const resolved = realPath(projectPath);
	const name = path.basename(resolved);
	const effectiveLabel = label ?? name;

	let remoteUrl: string | undefined;
	try {
		const url = execFileSync("git", ["-C", resolved, "remote", "get-url", "origin"], {
			encoding: "utf8",
			timeout: 2000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (url) remoteUrl = url;
	} catch {
		// not a git repo or no origin
	}

	const projectId = remoteUrl ?? resolved;
	return { name, label: effectiveLabel, path: resolved, remoteUrl, projectId };
}

// ── Project discovery ─────────────────────────────────────────────────────────

function dotfilesRoot(): string {
	return process.env.DOTFILES_ROOT || path.join(os.homedir(), ".dotfiles");
}

function isDirectory(value: string): boolean {
	try {
		return fs.statSync(value).isDirectory();
	} catch {
		return false;
	}
}

function isProjectContainer(rootPath: string, name: string): boolean {
	return rootPath === path.join(os.homedir(), "Projects") && name === "GitHub";
}

export function isWorktreeContainer(name: string): boolean {
	return name.endsWith("-worktrees") || name.endsWith(".worktrees");
}

const projectRoots = [
	{ path: path.join(os.homedir(), "Projects"), prefix: "" },
	{ path: path.join(os.homedir(), "Projects", "GitHub"), prefix: "GitHub/" },
];

export function discoverProjects(): ProjectInfo[] {
	const projects = new Map<string, ProjectInfo>();

	const dotfilesPath = dotfilesRoot();
	if (isDirectory(dotfilesPath)) {
		projects.set(realPath(dotfilesPath), projectInfoForPath(dotfilesPath, "dotfiles"));
	}

	for (const root of projectRoots) {
		if (!isDirectory(root.path)) continue;
		for (const name of fs.readdirSync(root.path).sort((a, b) => a.localeCompare(b))) {
			if (name.startsWith(".")) continue;
			if (isProjectContainer(root.path, name) || isWorktreeContainer(name)) continue;
			const projectPath = path.join(root.path, name);
			if (!isDirectory(projectPath)) continue;
			const key = realPath(projectPath);
			if (!projects.has(key)) {
				const label = `${root.prefix}${name}`;
				projects.set(key, projectInfoForPath(projectPath, label));
			}
		}
	}

	return [...projects.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function searchScore(project: ProjectInfo, query: string): number | null {
	const clean = query.trim();
	if (!clean) return 100;

	const expanded = clean.startsWith("~/") ? path.join(os.homedir(), clean.slice(2)) : clean;
	if (project.path === expanded) return 0;

	const needle = clean.toLowerCase();
	const label = project.label.toLowerCase();
	const name = project.name.toLowerCase();
	const projectPath = project.path.toLowerCase();
	const segments = label.split("/");

	if (name === needle) return 1;
	if (label === needle) return 2;
	if (name.startsWith(needle)) return 3;
	if (segments.some((segment) => segment.startsWith(needle))) return 4;
	if (label.startsWith(needle)) return 5;
	if (name.includes(needle)) return 6;
	if (label.includes(needle)) return 7;
	if (projectPath.includes(needle)) return 8;

	const tokens = needle.split(/\s+/).filter(Boolean);
	if (
		tokens.length > 1 &&
		tokens.every((token) => label.includes(token) || name.includes(token) || projectPath.includes(token))
	) {
		return 9;
	}

	return null;
}

export function findProjects(projects: ProjectInfo[], query: string): ProjectInfo[] {
	const scored = projects
		.map((project) => ({ project, score: searchScore(project, query) }))
		.filter((entry): entry is { project: ProjectInfo; score: number } => entry.score !== null);
	return scored
		.sort((a, b) => a.score - b.score || a.project.label.localeCompare(b.project.label))
		.map((entry) => entry.project);
}

// ── Worktree helpers ──────────────────────────────────────────────────────────

export function parseWorktreeList(output: string): WorktreeInfo[] {
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

export function getWorktreesRoot(projectRoot: string): string {
	const repoName = path.basename(projectRoot);
	return path.join(path.dirname(projectRoot), `${repoName}-worktrees`);
}

export function localBranchExists(branchName: string, cwd?: string): boolean {
	try {
		execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
			stdio: "ignore",
			timeout: 2000,
			...(cwd ? { cwd } : {}),
		});
		return true;
	} catch {
		return false;
	}
}

export function getUniqueWorkstreamTarget(
	projectRoot: string,
	task: string,
	opts?: { branchExists?: (branch: string) => boolean },
): { slug: string; branchName: string; worktreePath: string } {
	const worktreesRoot = getWorktreesRoot(projectRoot);
	const baseSlug = slugify(task);
	const branchExistsFn =
		opts?.branchExists ?? ((branch: string) => localBranchExists(branch, projectRoot));

	let slug = baseSlug;
	let branchName = `wt/${slug}`;
	let worktreePath = path.join(worktreesRoot, slug);
	let suffix = 2;

	while (fs.existsSync(worktreePath) || branchExistsFn(branchName)) {
		slug = `${baseSlug}-${suffix}`;
		branchName = `wt/${slug}`;
		worktreePath = path.join(worktreesRoot, slug);
		suffix++;
	}

	return { slug, branchName, worktreePath };
}

// ── Workstream ID ─────────────────────────────────────────────────────────────

/**
 * Stable, deterministic, filesystem-safe workstream id.
 * The projectId (which may be a remote URL) is hashed so it is not exposed
 * directly in the id string.
 */
export function workstreamId(projectId: string, slug: string): string {
	const projectHash = crypto.createHash("sha256").update(projectId).digest("hex").slice(0, 8);
	return `${projectHash}-${slug}`;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export function getRegistryFile(): string {
	return path.join(os.homedir(), ".pi", "agent", "workstream-registry.json");
}

export function readRegistry(): WorkstreamRegistry {
	const file = getRegistryFile();
	try {
		const raw = fs.readFileSync(file, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (
			parsed !== null &&
			typeof parsed === "object" &&
			"workstreams" in parsed &&
			Array.isArray((parsed as WorkstreamRegistry).workstreams)
		) {
			return parsed as WorkstreamRegistry;
		}
	} catch {
		// file missing, unreadable, or invalid JSON — return empty state
	}
	return { workstreams: [] };
}

export function writeRegistryAtomic(registry: WorkstreamRegistry): void {
	const file = getRegistryFile();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp.${process.pid}`;
	try {
		fs.writeFileSync(tmp, JSON.stringify(registry, null, 2) + "\n", "utf8");
		fs.renameSync(tmp, file);
	} catch (err) {
		try {
			fs.unlinkSync(tmp);
		} catch {
			// best-effort cleanup; ignore
		}
		throw err;
	}
}

export function upsertWorkstream(record: WorkstreamRecord): void {
	const registry = readRegistry();
	const idx = registry.workstreams.findIndex((r) => r.id === record.id);
	const now = new Date().toISOString();
	if (idx >= 0) {
		registry.workstreams[idx] = { ...registry.workstreams[idx], ...record, updatedAt: now };
	} else {
		registry.workstreams.push({ ...record, updatedAt: now });
	}
	writeRegistryAtomic(registry);
}

export function removeWorkstream(
	idOrPredicate: string | ((record: WorkstreamRecord) => boolean),
): void {
	const registry = readRegistry();
	const predicate =
		typeof idOrPredicate === "string"
			? (r: WorkstreamRecord) => r.id === idOrPredicate
			: idOrPredicate;
	registry.workstreams = registry.workstreams.filter((r) => !predicate(r));
	writeRegistryAtomic(registry);
}

export function findByWorktreePath(
	worktreePath: string,
	records?: WorkstreamRecord[],
): WorkstreamRecord | undefined {
	const list = records ?? readRegistry().workstreams;
	return list.find((r) => samePath(r.worktreePath, worktreePath));
}

export function findByIdOrSlugOrBranchOrPath(
	query: string,
	records?: WorkstreamRecord[],
): WorkstreamRecord | undefined {
	const list = records ?? readRegistry().workstreams;
	return (
		list.find((r) => r.id === query) ??
		list.find((r) => r.slug === query) ??
		list.find((r) => r.branch === query || r.branch === `wt/${query}`) ??
		list.find((r) => samePath(r.worktreePath, query))
	);
}

// ── Derived labels ────────────────────────────────────────────────────────────

export function deriveTaskFromWorktree(
	worktree: WorktreeInfo,
	record?: WorkstreamRecord,
): string {
	if (record?.task) return record.task;
	if (worktree.branch) {
		const branch = worktree.branch.replace(/^wt\//, "");
		return branch.replace(/-/g, " ");
	}
	return path.basename(worktree.path).replace(/-/g, " ") || "worktree";
}

export function isMainWorktree(worktrees: WorktreeInfo[], worktree: WorktreeInfo): boolean {
	return worktrees.length > 0 && samePath(worktrees[0].path, worktree.path);
}

export function worktreeBadges(
	worktree: WorktreeInfo,
	worktrees: WorktreeInfo[],
	currentRoot: string,
): string[] {
	const parts: string[] = [];
	if (samePath(worktree.path, currentRoot)) parts.push("current");
	if (isMainWorktree(worktrees, worktree)) parts.push("main");
	if (worktree.locked) parts.push("locked");
	if (worktree.prunable) parts.push("prunable");
	return parts;
}

/** Label for the repository's primary checkout. */
export function primaryLabel(_worktree: WorktreeInfo): string {
	return "Primary checkout";
}

export function findWorktree(worktrees: WorktreeInfo[], target: string): WorktreeInfo[] {
	const clean = target.trim();
	if (!clean) return [];
	return worktrees.filter(
		(worktree) =>
			worktree.path === clean ||
			path.basename(worktree.path) === clean ||
			worktree.branch === clean ||
			worktree.branch === `wt/${clean}`,
	);
}

// ── Session name ──────────────────────────────────────────────────────────────

/**
 * Write a `.pi/session-name` file under the given worktree path.
 * Throws on I/O error so callers can decide how to surface it.
 */
export function writeSessionName(worktreePath: string, task: string): void {
	const dir = path.join(worktreePath, ".pi");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "session-name"), task, "utf8");
}

/** Read `.pi/session-name` from cwd; returns undefined if absent or empty. */
export function readSessionName(cwd: string): string | undefined {
	const file = path.join(cwd, ".pi", "session-name");
	try {
		const content = fs.readFileSync(file, "utf8").trim();
		return content || undefined;
	} catch {
		return undefined;
	}
}
