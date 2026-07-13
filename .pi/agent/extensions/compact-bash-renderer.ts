/**
 * Compact renderer for Pi's built-in bash tool.
 *
 * This keeps Pi's built-in bash execution and result rendering, but replaces the
 * call/header view so long generated scripts do not fill the transcript by
 * default. Expanding the tool row shows the full command.
 */

import { createBashTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function meaningfulLines(command: string): string[] {
	return command
		.trim()
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function commandSummary(command: string): string {
	const lines = meaningfulLines(command);
	if (lines.length === 0) return "...";

	const first = oneLine(lines[0]);
	if (lines.length === 1) return first;

	const heredocCount = lines.filter((line) => /<<['\"]?[A-Za-z0-9_-]+['\"]?/.test(line)).length;
	const scriptLabel = heredocCount > 0 ? `script with ${heredocCount} heredoc${heredocCount === 1 ? "" : "s"}` : "script";
	return `${scriptLabel} (${lines.length} lines): ${first}`;
}

export default function compactBashRenderer(pi: ExtensionAPI) {
	const template = createBashTool(process.cwd());

	pi.registerTool({
		name: "bash",
		label: template.label,
		description: template.description,
		promptSnippet: template.promptSnippet,
		promptGuidelines: template.promptGuidelines,
		parameters: template.parameters,
		prepareArguments: template.prepareArguments,
		executionMode: template.executionMode,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const bash = createBashTool(ctx.cwd);
			return bash.execute(toolCallId, params, signal, onUpdate, ctx);
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const command = typeof args.command === "string" ? args.command : "";
			const timeout = typeof args.timeout === "number" ? args.timeout : undefined;
			const display = context.expanded
				? command.trim() || "..."
				: truncateToWidth(commandSummary(command), 120, "...");
			const timeoutSuffix = timeout ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";

			text.setText(theme.fg("toolTitle", theme.bold("$ ")) + theme.fg("accent", display) + timeoutSuffix);
			return text;
		},
	});
}
