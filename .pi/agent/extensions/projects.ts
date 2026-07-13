/**
 * /projects command — open a plain Pi session for a project folder in cmux.
 *
 * Scans immediate child directories under ~/Projects and ~/Projects/GitHub,
 * then starts `pi` in a new cmux workspace rooted at the selected project.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DynamicBorder, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, Text, type SettingItem } from "@earendil-works/pi-tui";

interface ProjectInfo {
	name: string;
	label: string;
	path: string;
}

const projectRoots = [
	{ path: path.join(os.homedir(), "Projects"), prefix: "" },
	{ path: path.join(os.homedir(), "Projects", "GitHub"), prefix: "GitHub/" },
];

function dotfilesRoot(): string {
	return process.env.DOTFILES_ROOT || path.join(os.homedir(), ".dotfiles");
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

function isWorktreeContainer(name: string): boolean {
	return name.endsWith("-worktrees") || name.endsWith(".worktrees");
}

function discoverProjects(): ProjectInfo[] {
	const projects = new Map<string, ProjectInfo>();
	const dotfilesPath = dotfilesRoot();
	if (isDirectory(dotfilesPath)) {
		projects.set(dotfilesPath, { name: "dotfiles", label: "dotfiles", path: dotfilesPath });
	}

	for (const root of projectRoots) {
		if (!isDirectory(root.path)) continue;
		for (const name of fs.readdirSync(root.path).sort((a, b) => a.localeCompare(b))) {
			if (name.startsWith(".")) continue;
			if (isProjectContainer(root.path, name) || isWorktreeContainer(name)) continue;

			const projectPath = path.join(root.path, name);
			if (!isDirectory(projectPath)) continue;

			const label = `${root.prefix}${name}`;
			projects.set(projectPath, { name, label, path: projectPath });
		}
	}

	return [...projects.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function searchScore(project: ProjectInfo, query: string): number | null {
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
	if (tokens.length > 1 && tokens.every((token) => label.includes(token) || name.includes(token) || projectPath.includes(token))) {
		return 9;
	}

	return null;
}

function findProjects(projects: ProjectInfo[], query: string): ProjectInfo[] {
	const scored = projects
		.map((project) => ({ project, score: searchScore(project, query) }))
		.filter((entry): entry is { project: ProjectInfo; score: number } => entry.score !== null);
	return scored
		.sort((a, b) => a.score - b.score || a.project.label.localeCompare(b.project.label))
		.map((entry) => entry.project);
}

function extractWorkspaceRef(output: string): string | null {
	const match = output.match(/workspace:(\S+)/);
	return match ? `workspace:${match[1]}` : null;
}

function piCommand(project: ProjectInfo): string {
	return `PI_SESSION_NAME=${shellQuote(project.name)} pi`;
}

export default function projectsExtension(pi: ExtensionAPI) {
	type CmuxWorkspaceGroup = {
		id?: string;
		ref?: string;
		group_ref?: string;
		workspace_group_ref?: string;
		name?: string;
		title?: string;
		label?: string;
		display_name?: string;
	};

	function cmuxWorkspaceGroupRef(group: CmuxWorkspaceGroup): string | undefined {
		return group.ref ?? group.group_ref ?? group.workspace_group_ref ?? group.id;
	}

	function cmuxWorkspaceGroupName(group: CmuxWorkspaceGroup): string | undefined {
		return group.name ?? group.title ?? group.label ?? group.display_name;
	}

	async function listCmuxWorkspaceGroups(): Promise<CmuxWorkspaceGroup[]> {
		const result = await pi.exec("cmux", ["workspace-group", "list", "--json"]);
		if (result.code !== 0 || !result.stdout.trim()) return [];
		try {
			const parsed = JSON.parse(result.stdout) as { groups?: CmuxWorkspaceGroup[] };
			return parsed.groups ?? [];
		} catch {
			return [];
		}
	}

	async function findCmuxWorkspaceGroupRefByName(name: string): Promise<string | undefined> {
		const groups = await listCmuxWorkspaceGroups();
		const group = groups.find((group) => cmuxWorkspaceGroupName(group) === name);
		return group ? cmuxWorkspaceGroupRef(group) : undefined;
	}

	async function createCmuxWorkspaceGroupFromWorkspace(name: string, workspaceRef: string): Promise<void> {
		await pi.exec("cmux", ["workspace-group", "create", "--name", name, "--from", workspaceRef, "--json"]);
	}

	async function launchProject(ctx: ExtensionCommandContext, project: ProjectInfo): Promise<void> {
		if (!isCmux()) {
			ctx.ui.notify("/projects requires cmux", "error");
			return;
		}

		const groupRef = await findCmuxWorkspaceGroupRefByName(project.name);
		const createArgs = [
			"workspace",
			"create",
			"--name",
			project.label,
			"--cwd",
			project.path,
			"--command",
			piCommand(project),
			"--focus",
			"true",
		];
		if (groupRef) createArgs.push("--group", groupRef, "--group-placement", "end");
		const result = await pi.exec("cmux", createArgs);

		if (result.code !== 0) {
			const reason = result.stderr.trim() || result.stdout.trim() || "failed to create cmux workspace";
			ctx.ui.notify(reason, "error");
			return;
		}

		const workspaceRef = extractWorkspaceRef(result.stdout || result.stderr || "");
		if (workspaceRef) {
			if (!groupRef) await createCmuxWorkspaceGroupFromWorkspace(project.name, workspaceRef);
			await sleep(200);
			await pi.exec("cmux", ["workspace", "select", workspaceRef]);
		}

		ctx.ui.notify(`Opened ${project.label}`, "info");
	}

	function sendProjectsList(projects: ProjectInfo[]): void {
		const message = [
			"Projects",
			"",
			...projects.map((project) => `- ${project.label} — ${project.path}`),
			"",
			"Open one with `/projects <name>`.",
		].join("\n");
		pi.sendMessage({
			customType: "projects-list",
			content: [{ type: "text", text: message }],
			display: "user",
		});
	}

	async function selectProject(ctx: ExtensionCommandContext, projects: ProjectInfo[], title = "Projects"): Promise<ProjectInfo | undefined> {
		const projectById = new Map(projects.map((project) => [project.path, project]));

		return ctx.ui.custom<ProjectInfo | undefined>((_tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(new Text(
				theme.fg("accent", theme.bold(` ${title}`)) + theme.fg("muted", ` • ${projects.length} projects`),
				0, 0,
			));

			const items: SettingItem[] = projects.map((project) => ({
				id: project.path,
				label: project.label,
				description: project.path,
				currentValue: "open",
				values: ["open"],
			}));

			const settingsList = new SettingsList(items, Math.min(projects.length, 15), {
				label: (text, selected) => selected ? theme.fg("accent", text) : text,
				value: (text, selected) => selected ? theme.fg("accent", text) : theme.fg("muted", text),
				description: (text) => theme.fg("muted", text),
				cursor: theme.fg("accent", "→ "),
				hint: (text) => theme.fg("dim", text),
			}, (id) => {
				done(projectById.get(id));
			}, () => done(undefined), { enableSearch: true });
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

	const handler = async (args: string, ctx: ExtensionCommandContext) => {
		const query = args.trim();
		const projects = discoverProjects();
		if (projects.length === 0) {
			ctx.ui.notify("No project folders found", "warning");
			return;
		}

		if (query === "list" || query === "ls") {
			sendProjectsList(projects);
			return;
		}

		let project: ProjectInfo | undefined;
		if (!query) {
			if (!ctx.hasUI) {
				sendProjectsList(projects);
				return;
			}
			project = await selectProject(ctx, projects);
		} else {
			const matches = findProjects(projects, query);
			if (matches.length === 0) {
				ctx.ui.notify("No matching project found", "error");
				return;
			}
			if (matches.length === 1 || !ctx.hasUI) {
				project = matches[0];
			} else {
				project = await selectProject(ctx, matches, "Matching projects");
			}
		}

		if (!project) return;
		await launchProject(ctx, project);
	};

	pi.registerCommand("projects", {
		description: "Open a plain Pi session for a project folder in a new cmux workspace",
		getArgumentCompletions: (prefix) => {
			const clean = prefix.trim();
			const commandMatches = ["list"].filter((value) => value.startsWith(clean.toLowerCase()));
			const projectMatches = clean ? findProjects(discoverProjects(), clean) : discoverProjects();
			return [...commandMatches, ...projectMatches.map((project) => project.label)]
				.slice(0, 25)
				.map((value) => ({ value, label: value }));
		},
		handler,
	});
}
