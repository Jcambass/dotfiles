import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const TargetType = StringEnum(["project", "area", "resource"] as const);

const PROJECTS_DIR = "10 - Projects";
const AREAS_DIR = "20 - Areas";
const RESOURCES_DIR = "30 - Resources";
const MEETINGS_DIR = "30 - Resources/Meetings";
const ARCHIVE_DIR = "40 - Archive";

const NOTE_SUBCOMMANDS: AutocompleteItem[] = [
	{ value: "meeting ", label: "meeting", description: "Create/reuse a meeting note; no title uses current meeting" },
	{ value: "project ", label: "project", description: "Create/reuse a Project folder" },
	{ value: "area ", label: "area", description: "Create/reuse an Area folder" },
	{ value: "resource ", label: "resource", description: "Create/reuse a Resource folder" },
	{ value: "open ", label: "open", description: "Open the notes root or a selected note/folder" },
];

function noteCommand(): string {
	const dotfilesRoot = process.env.DOTFILES_ROOT || path.join(os.homedir(), ".dotfiles");
	const managed = path.join(dotfilesRoot, "common", "notes", "bin", "note");
	if (fs.existsSync(managed)) return managed;
	return "note";
}

function notesRoot(): string {
	return process.env.NOTES_ROOT || path.join(os.homedir(), "Notes");
}

function compactOutput(stdout: string, stderr: string): string {
	return (stdout.trim() || stderr.trim()).trim();
}

function nonEmpty(value: string | undefined, label: string): string {
	const text = value?.trim();
	if (!text) throw new Error(`${label} is required`);
	return text;
}

function noteCwd(): string {
	const root = notesRoot();
	return fs.existsSync(root) ? root : os.homedir();
}

async function runNote(pi: ExtensionAPI, args: string[], cwd?: string): Promise<string> {
	const result = await pi.exec(noteCommand(), args, { cwd: cwd || noteCwd(), timeout: 30_000 });
	if (result.code !== 0) {
		throw new Error(compactOutput(result.stdout, result.stderr) || `note exited with ${result.code}`);
	}
	return compactOutput(result.stdout, result.stderr);
}

function successMessage(action: string, output: string): string {
	return output ? `${action}: ${output}` : action;
}

type FeedbackLevel = "info" | "warning" | "error";

function commandFeedback(pi: ExtensionAPI, ctx: ExtensionCommandContext, message: string, level: FeedbackLevel = "info"): void {
	ctx.ui.notify(message, level);
	pi.sendMessage({
		customType: "note-feedback",
		content: message,
		display: true,
		details: { level },
	});
}

function commandErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function openInNeovim(ctx: ExtensionCommandContext, targetPath: string): Promise<boolean | undefined> {
	if (ctx.mode !== "tui") return undefined;

	const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
		tui.stop();
		process.stdout.write("\x1b[2J\x1b[H");
		const result = spawnSync("nvim", [targetPath], { cwd: notesRoot(), stdio: "inherit", env: process.env });
		tui.start();
		tui.requestRender(true);
		done(result.status ?? 1);
		return { render: () => [], invalidate: () => {} };
	});

	return exitCode === 0;
}

function stripMatchingQuotes(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function quoteNoteArg(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function noteRelPath(absPath: string): string {
	return path.relative(notesRoot(), absPath).split(path.sep).join("/");
}

function isVisibleNoteEntry(entry: fs.Dirent): boolean {
	return !entry.name.startsWith(".") && !entry.name.endsWith("~");
}

function readDirs(dir: string): fs.Dirent[] {
	try {
		return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => isVisibleNoteEntry(entry) && entry.isDirectory());
	} catch {
		return [];
	}
}

function readNoteEntries(dir: string): fs.Dirent[] {
	try {
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((entry) => isVisibleNoteEntry(entry) && (entry.isDirectory() || (entry.isFile() && entry.name.endsWith(".md"))));
	} catch {
		return [];
	}
}

function titleFromMarkdown(filePath: string): string | undefined {
	try {
		const text = fs.readFileSync(filePath, "utf8");
		const match = text.match(/^title:\s*(.+)$/m);
		return match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
	} catch {
		return undefined;
	}
}

function filterCompletions(items: AutocompleteItem[], prefix: string): AutocompleteItem[] | null {
	const normalized = prefix.trim().toLowerCase();
	const filtered = normalized
		? items.filter((item) => `${item.label}\n${item.value}\n${item.description ?? ""}`.toLowerCase().includes(normalized))
		: items;
	return filtered.length > 0 ? filtered : null;
}

function categoryCompletions(subcommand: "project" | "area" | "resource", dirName: string): AutocompleteItem[] {
	const dir = path.join(notesRoot(), dirName);
	return readDirs(dir)
		.filter((entry) => !(subcommand === "resource" && entry.name === "Meetings"))
		.map((entry) => ({
			value: `${subcommand} ${quoteNoteArg(entry.name)}`,
			label: `${subcommand} ${entry.name}`,
			description: `Existing ${subcommand} folder`,
		}));
}

function meetingCompletions(): AutocompleteItem[] {
	const dir = path.join(notesRoot(), MEETINGS_DIR);
	const entries = readNoteEntries(dir)
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => {
			const filePath = path.join(dir, entry.name);
			const stat = fs.statSync(filePath);
			const title = titleFromMarkdown(filePath) || entry.name.replace(/^[0-9-]+\s+[0-9]+\s+-\s+/, "").replace(/\.md$/, "");
			return { filePath, title, mtime: stat.mtimeMs };
		})
		.sort((a, b) => b.mtime - a.mtime)
		.slice(0, 25);

	return [
		{ value: "meeting ", label: "meeting current", description: "Use current calendar meeting" },
		...entries.map((entry) => ({
			value: `meeting ${quoteNoteArg(entry.title)}`,
			label: `meeting ${entry.title}`,
			description: noteRelPath(entry.filePath),
		})),
	];
}

function openCompletions(): AutocompleteItem[] {
	const root = notesRoot();
	const bases = [PROJECTS_DIR, AREAS_DIR, RESOURCES_DIR, ARCHIVE_DIR]
		.map((rel) => path.join(root, rel))
		.filter((dir) => fs.existsSync(dir));
	const items: AutocompleteItem[] = [{ value: "open ", label: "open notes root", description: root }];
	const stack = bases.map((dir) => ({ dir, depth: 0 }));

	while (stack.length > 0 && items.length < 120) {
		const current = stack.shift();
		if (!current) break;
		for (const entry of readNoteEntries(current.dir)) {
			const entryPath = path.join(current.dir, entry.name);
			const rel = noteRelPath(entryPath);
			if (entry.isDirectory()) {
				items.push({ value: `open ${quoteNoteArg(rel)}`, label: `open ${rel}/`, description: "Folder" });
				if (current.depth < 3) stack.push({ dir: entryPath, depth: current.depth + 1 });
			} else {
				items.push({ value: `open ${quoteNoteArg(rel)}`, label: `open ${rel}`, description: titleFromMarkdown(entryPath) || "Markdown note" });
			}
			if (items.length >= 120) break;
		}
	}

	return items;
}

function noteArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const trimmed = argumentPrefix.trimStart();
	const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
	const subcommand = match?.[1] || "";
	const hasSubcommandSpace = /\s$/.test(trimmed) || Boolean(match?.[2]);

	if (!subcommand || !hasSubcommandSpace) return filterCompletions(NOTE_SUBCOMMANDS, trimmed);

	const items = (() => {
		switch (subcommand) {
			case "project":
				return categoryCompletions("project", PROJECTS_DIR);
			case "area":
				return categoryCompletions("area", AREAS_DIR);
			case "resource":
				return categoryCompletions("resource", RESOURCES_DIR);
			case "meeting":
				return meetingCompletions();
			case "open":
				return openCompletions();
			default:
				return NOTE_SUBCOMMANDS;
		}
	})();

	return filterCompletions(items, trimmed);
}

function resolveNotePath(target: string): string {
	const root = notesRoot();
	const trimmed = stripMatchingQuotes(target);
	const targetPath = trimmed ? (path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed)) : root;
	const resolvedRoot = path.resolve(root);
	if (targetPath !== resolvedRoot && !targetPath.startsWith(`${resolvedRoot}${path.sep}`)) {
		throw new Error(`Refusing to open path outside notes root: ${target}`);
	}
	return targetPath;
}

async function selectNoteSubcommand(ctx: ExtensionCommandContext): Promise<string | undefined> {
	if (ctx.mode !== "tui") return undefined;
	const labels = [
		"Open notes or a note file",
		"Create/reuse meeting note",
		"Create project",
		"Create area",
		"Create resource",
	];
	const selected = await ctx.ui.select("Note action", labels);
	switch (selected) {
		case "Open notes or a note file":
			return "open";
		case "Create/reuse meeting note":
			return "meeting";
		case "Create project":
			return "project";
		case "Create area":
			return "area";
		case "Create resource":
			return "resource";
		default:
			return undefined;
	}
}

async function selectOpenTarget(ctx: ExtensionCommandContext): Promise<string | undefined> {
	if (ctx.mode !== "tui") return undefined;
	const items = openCompletions();
	const labels = items.map((item) => (item.description ? `${item.label} — ${item.description}` : item.label));
	const selected = await ctx.ui.select("Open note", labels);
	if (!selected) return undefined;
	const item = items[labels.indexOf(selected)];
	return item?.value.replace(/^open\s*/, "").trim();
}

async function inputIfMissing(ctx: ExtensionCommandContext, value: string, title: string): Promise<string> {
	if (value.trim() || ctx.mode !== "tui") return value.trim();
	return (await ctx.ui.input(title, "Name"))?.trim() || "";
}

function parseNewArgs(args: string): string[] {
	const trimmed = args.trim();
	if (!trimmed) throw new Error("name is required");
	const match = trimmed.match(/^--prefix\s+(\S+)\s+(.+)$/);
	if (match) return ["--prefix", match[1], match[2]];
	return [trimmed];
}

function parseMeetingCandidates(message: string): Array<{ start: string; subject: string }> {
	return message
		.split(/\r?\n/)
		.map((line) => line.split("\t"))
		.filter((parts) => parts[0] === "CANDIDATE" && parts[1] && parts[2])
		.map((parts) => ({ start: parts[1], subject: parts.slice(2).join("\t") }));
}

function meetingArgs(params: { project?: string; area?: string; body?: string }, extra: string[] = []): string[] {
	const args = ["meeting", "current", ...extra];
	if (params.project?.trim()) args.push("--project", params.project.trim());
	if (params.area?.trim()) args.push("--area", params.area.trim());
	args.push(params.body?.trim() || " ");
	return args;
}

async function runCurrentMeeting(pi: ExtensionAPI, ctx: { hasUI: boolean; ui: { select: (title: string, items: string[]) => Promise<string | undefined> } }, params: { project?: string; area?: string; body?: string }): Promise<string> {
	try {
		return await runNote(pi, meetingArgs(params));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const candidates = parseMeetingCandidates(message);
		if (candidates.length === 0 || !ctx.hasUI) throw error;

		const labels = candidates.map((candidate) => `${candidate.start}  ${candidate.subject}`);
		const selected = await ctx.ui.select("Pick current meeting", labels);
		if (!selected) throw new Error("No meeting selected");
		const index = labels.indexOf(selected);
		if (index < 0) throw new Error("Invalid meeting selection");
		const candidate = candidates[index];
		return runNote(pi, meetingArgs(params, ["--choose-start", candidate.start, "--choose-subject", candidate.subject]));
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "note_project_create",
		label: "Create Project Note Folder",
		description: "Create a Project folder in the private notes repository under '10 - Projects'.",
		promptSnippet: "Create Project folders in the user's private numbered PARA notes repository",
		promptGuidelines: [
			"Use note_project_create when the user asks to create a notes Project.",
			"Do not create inbox notes; notes must target Project, Area, Resource, or Meeting.",
		],
		parameters: Type.Object({
			title: Type.String({ description: "Project name" }),
			prefix: Type.Optional(Type.String({ description: "Optional numeric prefix, e.g. 10.2" })),
		}),
		async execute(_id, params) {
			const args = ["project", "new"];
			if (params.prefix?.trim()) args.push("--prefix", params.prefix.trim());
			args.push(nonEmpty(params.title, "title"));
			const output = await runNote(pi, args);
			return { content: [{ type: "text", text: successMessage("Created project", output) }], details: { path: output } };
		},
	});

	pi.registerTool({
		name: "note_area_create",
		label: "Create Area Note Folder",
		description: "Create an Area folder in the private notes repository under '20 - Areas'.",
		promptSnippet: "Create Area folders in the user's private numbered PARA notes repository",
		promptGuidelines: ["Use note_area_create when the user asks to create a notes Area."],
		parameters: Type.Object({
			title: Type.String({ description: "Area name" }),
			prefix: Type.Optional(Type.String({ description: "Optional numeric prefix, e.g. 20.2" })),
		}),
		async execute(_id, params) {
			const args = ["area", "new"];
			if (params.prefix?.trim()) args.push("--prefix", params.prefix.trim());
			args.push(nonEmpty(params.title, "title"));
			const output = await runNote(pi, args);
			return { content: [{ type: "text", text: successMessage("Created area", output) }], details: { path: output } };
		},
	});

	pi.registerTool({
		name: "note_resource_create",
		label: "Create Resource Note Folder",
		description: "Create a Resource folder in the private notes repository under '30 - Resources'.",
		promptSnippet: "Create Resource folders in the user's private numbered PARA notes repository",
		promptGuidelines: ["Use note_resource_create when the user asks to create a notes Resource topic."],
		parameters: Type.Object({ title: Type.String({ description: "Resource topic" }) }),
		async execute(_id, params) {
			const output = await runNote(pi, ["resource", "new", nonEmpty(params.title, "title")]);
			return { content: [{ type: "text", text: successMessage("Created resource", output) }], details: { path: output } };
		},
	});

	pi.registerTool({
		name: "note_add",
		label: "Add Private Note",
		description: "Add a private Markdown note to a Project, Area, or Resource. Never writes to an inbox.",
		promptSnippet: "Add private Markdown notes directly to a Project, Area, or Resource",
		promptGuidelines: [
			"Use note_add only when the user has specified a Project, Area, or Resource target.",
			"Do not use note_add for meeting notes; use note_meeting_create instead.",
			"Do not create or suggest inbox notes.",
		],
		parameters: Type.Object({
			targetType: TargetType,
			target: Type.String({ description: "Existing Project, Area, or Resource name/folder" }),
			title: Type.String({ description: "Note title" }),
			body: Type.String({ description: "Note body" }),
		}),
		async execute(_id, params) {
			const body = nonEmpty(params.body, "body");
			const output = await runNote(pi, ["add", params.targetType, nonEmpty(params.target, "target"), "--title", nonEmpty(params.title, "title"), body]);
			return { content: [{ type: "text", text: successMessage("Added note", output) }], details: { path: output } };
		},
	});

	pi.registerTool({
		name: "note_meeting_create",
		label: "Create Meeting Note",
		description: "Create or reuse a private meeting note under '30 - Resources/Meetings'. Uses the current calendar meeting when no title is supplied.",
		promptSnippet: "Create or reuse meeting notes under the user's Resources/Meetings folder",
		promptGuidelines: [
			"Use note_meeting_create for meeting notes; meeting notes belong under 30 - Resources/Meetings.",
			"If no title is supplied, note_meeting_create uses the current calendar meeting.",
			"Do not invent meeting details, decisions, attendees, or action items.",
		],
		parameters: Type.Object({
			title: Type.Optional(Type.String({ description: "Meeting title. Omit to use the current calendar meeting." })),
			body: Type.Optional(Type.String({ description: "Meeting note body" })),
			project: Type.Optional(Type.String({ description: "Optional Project link" })),
			area: Type.Optional(Type.String({ description: "Optional Area link" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			let output: string;
			if (params.title?.trim()) {
				const args: string[] = ["meeting", "--title", params.title.trim()];
				if (params.project?.trim()) args.push("--project", params.project.trim());
				if (params.area?.trim()) args.push("--area", params.area.trim());
				args.push(params.body?.trim() || " ");
				output = await runNote(pi, args);
			} else {
				output = await runCurrentMeeting(pi, ctx, params);
			}
			return { content: [{ type: "text", text: successMessage("Created/reused meeting note", output) }], details: { path: output } };
		},
	});

	pi.registerTool({
		name: "note_archive",
		label: "Archive Note Target",
		description: "Move a Project, Area, or Resource into '40 - Archive'. Does not delete content.",
		parameters: Type.Object({
			targetType: TargetType,
			target: Type.String({ description: "Existing target to archive" }),
		}),
		async execute(_id, params) {
			const output = await runNote(pi, ["archive", params.targetType, nonEmpty(params.target, "target")]);
			return { content: [{ type: "text", text: successMessage("Archived", output) }], details: { path: output } };
		},
	});

	pi.registerCommand("note", {
		description: "Notes commands: /note meeting [title], /note project [--prefix 10.2] <name>, /note area [--prefix 20.2] <name>, /note resource <name>, /note open [path]",
		getArgumentCompletions: noteArgumentCompletions,
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
			let subcommand = match?.[1] || "";
			let rest = match?.[2]?.trim() || "";

			if (!subcommand) {
				const selectedSubcommand = await selectNoteSubcommand(ctx);
				if (!selectedSubcommand) {
					commandFeedback(pi, ctx, "Usage: /note meeting [title] | /note project [--prefix 10.2] <name> | /note area [--prefix 20.2] <name> | /note resource <name> | /note open [path]", "warning");
					return;
				}
				subcommand = selectedSubcommand;
			}

			try {
				switch (subcommand) {
					case "project": {
						const projectArgs = await inputIfMissing(ctx, rest, "Project name");
						const output = await runNote(pi, ["project", "new", ...parseNewArgs(projectArgs)]);
						commandFeedback(pi, ctx, successMessage("Created project", output));
						if ((await openInNeovim(ctx, output)) === false) commandFeedback(pi, ctx, `Failed to open notes: ${output}`, "error");
						return;
					}
					case "area": {
						const areaArgs = await inputIfMissing(ctx, rest, "Area name");
						const output = await runNote(pi, ["area", "new", ...parseNewArgs(areaArgs)]);
						commandFeedback(pi, ctx, successMessage("Created area", output));
						if ((await openInNeovim(ctx, output)) === false) commandFeedback(pi, ctx, `Failed to open notes: ${output}`, "error");
						return;
					}
					case "resource": {
						const title = nonEmpty(await inputIfMissing(ctx, rest, "Resource name"), "resource name");
						const output = await runNote(pi, ["resource", "new", title]);
						commandFeedback(pi, ctx, successMessage("Created resource", output));
						if ((await openInNeovim(ctx, output)) === false) commandFeedback(pi, ctx, `Failed to open notes: ${output}`, "error");
						return;
					}
					case "meeting": {
						let title = stripMatchingQuotes(rest.replace(/^--title\s+/, ""));
						if (!title) {
							try {
								const output = await runCurrentMeeting(pi, ctx, {});
								commandFeedback(pi, ctx, successMessage("Created/reused meeting note", output));
								if ((await openInNeovim(ctx, output)) === false) commandFeedback(pi, ctx, `Failed to open notes: ${output}`, "error");
								return;
							} catch {
								if (ctx.hasUI) title = (await ctx.ui.input("Meeting title", "Title"))?.trim() || "";
							}
						}

						if (!title) {
							commandFeedback(pi, ctx, "Meeting title required", "error");
							return;
						}

						const output = await runNote(pi, ["meeting", "--title", title, " "]);
						commandFeedback(pi, ctx, successMessage("Created/reused meeting note", output));
						if ((await openInNeovim(ctx, output)) === false) commandFeedback(pi, ctx, `Failed to open notes: ${output}`, "error");
						return;
					}
					case "open": {
						const targetArg = rest || (await selectOpenTarget(ctx)) || "";
						const targetPath = resolveNotePath(targetArg);
						if (ctx.mode !== "tui") {
							commandFeedback(pi, ctx, `Notes: ${targetPath}`);
							return;
						}

						const opened = await openInNeovim(ctx, targetPath);
						if (opened === false) {
							commandFeedback(pi, ctx, `Failed to open notes: ${targetPath}`, "error");
						} else if (opened === true) {
							commandFeedback(pi, ctx, `Opened notes: ${targetPath}`);
						}
						return;
					}
					default:
						commandFeedback(pi, ctx, "Usage: /note meeting [title] | /note project [--prefix 10.2] <name> | /note area [--prefix 20.2] <name> | /note resource <name> | /note open [path]", "warning");
				}
			} catch (error) {
				commandFeedback(pi, ctx, commandErrorMessage(error), "error");
			}
		},
	});
}
