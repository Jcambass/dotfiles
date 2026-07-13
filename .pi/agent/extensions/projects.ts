/**
 * /projects command — open a plain Pi session for a project folder in cmux.
 *
 * Scans immediate child directories under ~/Projects and ~/Projects/GitHub,
 * then starts `pi` in a new cmux workspace rooted at the selected project.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

interface ProjectInfo {
	name: string;
	label: string;
	path: string;
}

const projectRoots = [
	{ path: path.join(os.homedir(), "Projects"), prefix: "" },
	{ path: path.join(os.homedir(), "Projects", "GitHub"), prefix: "GitHub/" },
];

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

function findProjects(projects: ProjectInfo[], query: string): ProjectInfo[] {
	const clean = query.trim();
	if (!clean) return [];

	const expanded = clean.startsWith("~/") ? path.join(os.homedir(), clean.slice(2)) : clean;
	const exact = projects.filter((project) => {
		return project.path === expanded
			|| project.label === clean
			|| project.name === clean;
	});
	if (exact.length > 0) return exact;

	const needle = clean.toLowerCase();
	return projects.filter((project) => {
		return project.label.toLowerCase().includes(needle)
			|| project.name.toLowerCase().includes(needle);
	});
}

function extractWorkspaceRef(output: string): string | null {
	const match = output.match(/workspace:(\S+)/);
	return match ? `workspace:${match[1]}` : null;
}

function piCommand(project: ProjectInfo): string {
	return `PI_SESSION_NAME=${shellQuote(project.name)} pi`;
}

export default function projectsExtension(pi: ExtensionAPI) {
	async function launchProject(ctx: ExtensionCommandContext, project: ProjectInfo): Promise<void> {
		if (!isCmux()) {
			ctx.ui.notify("/projects requires cmux", "error");
			return;
		}

		const result = await pi.exec("cmux", [
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
		]);

		if (result.code !== 0) {
			const reason = result.stderr.trim() || result.stdout.trim() || "failed to create cmux workspace";
			ctx.ui.notify(reason, "error");
			return;
		}

		const workspaceRef = extractWorkspaceRef(result.stdout || result.stderr || "");
		if (workspaceRef) {
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
		const labels = new Map<string, ProjectInfo>();
		for (const project of projects) labels.set(project.label, project);
		const selected = await ctx.ui.select(title, [...labels.keys()]);
		return selected ? labels.get(selected) : undefined;
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
			const values = ["list", ...discoverProjects().map((project) => project.label)];
			return values
				.filter((value) => value.toLowerCase().startsWith(prefix.toLowerCase()))
				.slice(0, 25)
				.map((value) => ({ value, label: value }));
		},
		handler,
	});
}
