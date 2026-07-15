/**
 * Kusto Command Extension — config-driven slash commands backed by Kusto
 *
 * Registers a Pi slash command per entry in a local JSON config file. Each
 * command has one or more named subcommands (each a KQL query), run against
 * a Kusto cluster using an AAD token from `az account get-access-token`.
 *
 * This extension is intentionally generic: it holds no cluster names,
 * database/table names, or KQL of its own. All of that — which is often
 * internal/company-specific — lives in the config file, not in git.
 *
 * Config file: $PI_KUSTO_COMMANDS_CONFIG, or ~/.config/pi/kusto-commands.json
 * if unset. Missing config file = no commands registered (silent no-op).
 *
 * Config schema:
 * {
 *   "commands": [
 *     {
 *       "name": "my-command",
 *       "description": "Shown in the command palette",
 *       "cluster": "https://<cluster>.kusto.windows.net",
 *       "authResource": "https://kusto.kusto.windows.net",   // optional, this is the default
 *       "loginHint": "you@example.com",                       // optional, shown on auth errors
 *       "defaultSubcommand": "total",
 *       "defaultDays": 30,
 *       "subcommands": {
 *         "total": {
 *           "title": "Shown as the result heading",
 *           "db": "database-name",
 *           "csl": "TableName | where Timestamp >= ago({{days}}d) | ..."
 *         }
 *       }
 *     }
 *   ]
 * }
 *
 * KQL bodies may use the {{days}} placeholder; it's replaced with the
 * resolved day count (from an argument like `7d`/`90` or defaultDays).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DEFAULT_AUTH_RESOURCE = "https://kusto.kusto.windows.net";

interface SubcommandConfig {
	title?: string;
	db: string;
	csl: string;
}

interface CommandConfig {
	name: string;
	description?: string;
	cluster: string;
	authResource?: string;
	loginHint?: string;
	defaultSubcommand?: string;
	defaultDays?: number;
	subcommands: Record<string, SubcommandConfig>;
}

interface KustoCommandsConfig {
	commands: CommandConfig[];
}

interface KustoTable {
	TableName?: string;
	Columns: Array<{ ColumnName: string; ColumnType?: string; DataType?: string }>;
	Rows: unknown[][];
}

interface KustoResponse {
	Tables: KustoTable[];
}

// ── config loading ────────────────────────────────────────────────────────

function configPath(): string {
	return process.env.PI_KUSTO_COMMANDS_CONFIG?.trim() || path.join(os.homedir(), ".config", "pi", "kusto-commands.json");
}

function loadConfig(): KustoCommandsConfig | null {
	const file = configPath();
	if (!fs.existsSync(file)) return null;
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as KustoCommandsConfig;
		if (!Array.isArray(parsed.commands)) return null;
		return parsed;
	} catch {
		return null;
	}
}

// ── auth ──────────────────────────────────────────────────────────────────

const tokenCache = new Map<string, { value: string; expiresAt: number }>();

async function getAccessToken(pi: ExtensionAPI, resource: string, loginHint?: string): Promise<string> {
	const cached = tokenCache.get(resource);
	if (cached && cached.expiresAt > Date.now()) return cached.value;

	const result = await pi.exec("az", [
		"account",
		"get-access-token",
		"--resource",
		resource,
		"--query",
		"accessToken",
		"-o",
		"tsv",
	]);

	if (result.code !== 0) {
		const reason = result.stderr.trim() || result.stdout.trim();
		const hint = loginHint ? ` and pick your ${loginHint} account` : "";
		throw new Error(`az login required (or expired). Run \`az login\`${hint}.\n${reason}`);
	}

	const token = result.stdout.trim();
	if (!token) throw new Error("az returned an empty access token");

	tokenCache.set(resource, { value: token, expiresAt: Date.now() + 20 * 60 * 1000 });
	return token;
}

// ── query execution ──────────────────────────────────────────────────────

async function runKustoQuery(
	pi: ExtensionAPI,
	cluster: string,
	resource: string,
	loginHint: string | undefined,
	db: string,
	csl: string,
): Promise<KustoTable> {
	const token = await getAccessToken(pi, resource, loginHint);

	const response = await fetch(`${cluster.replace(/\/$/, "")}/v1/rest/query`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: JSON.stringify({ db, csl }),
	});

	const text = await response.text();
	if (!response.ok) {
		throw new Error(`Kusto query failed (${response.status}): ${text.slice(0, 800)}`);
	}

	let parsed: KustoResponse;
	try {
		parsed = JSON.parse(text) as KustoResponse;
	} catch {
		throw new Error(`Unexpected Kusto response: ${text.slice(0, 800)}`);
	}

	const table = parsed.Tables?.[0];
	if (!table) throw new Error("Kusto returned no result table");
	return table;
}

// ── formatting ────────────────────────────────────────────────────────────

function formatCell(value: unknown): string {
	if (value === null || value === undefined) return "";
	return String(value);
}

function formatTable(table: KustoTable): string {
	const headers = table.Columns.map((c) => c.ColumnName);
	if (table.Rows.length === 0) return "_no rows_";

	const lines = [
		`| ${headers.join(" | ")} |`,
		`| ${headers.map(() => "---").join(" | ")} |`,
		...table.Rows.map((row) => `| ${row.map(formatCell).join(" | ")} |`),
	];
	return lines.join("\n");
}

/** Best-effort total for any column whose name looks cost-like. */
function costTotal(table: KustoTable): string | null {
	const costIdx = table.Columns.findIndex((c) => /cogs|cost/i.test(c.ColumnName));
	if (costIdx === -1) return null;
	const total = table.Rows.reduce((sum, row) => sum + (Number(row[costIdx]) || 0), 0);
	return `$${total.toFixed(2)}`;
}

// ── command wiring ────────────────────────────────────────────────────────

function parseArgs(cmd: CommandConfig, args: string): { sub: string; days: number } {
	const subNames = Object.keys(cmd.subcommands);
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const sub = tokens.find((t) => subNames.includes(t)) ?? cmd.defaultSubcommand ?? subNames[0];
	const daysToken = tokens.find((t) => /^\d+d?$/.test(t));
	const parsedDays = daysToken ? Number.parseInt(daysToken, 10) : (cmd.defaultDays ?? 30);
	const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : (cmd.defaultDays ?? 30);
	return { sub, days };
}

function registerCommand(pi: ExtensionAPI, cmd: CommandConfig): void {
	const subNames = Object.keys(cmd.subcommands);
	if (subNames.length === 0) return;

	pi.registerCommand(cmd.name, {
		description: cmd.description ?? `Run a Kusto-backed query (${subNames.join("|")})`,
		getArgumentCompletions: (prefix: string) => {
			const clean = prefix.trim().toLowerCase();
			return subNames.filter((c) => c.startsWith(clean)).map((v) => ({ value: v, label: v }));
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const { sub, days } = parseArgs(cmd, args);
			const subConfig = cmd.subcommands[sub];
			if (!subConfig) {
				ctx.ui.notify(`Unknown subcommand "${sub}". Options: ${subNames.join(", ")}`, "error");
				return;
			}

			ctx.ui.notify(`Querying Kusto: ${sub} (${days}d)...`, "info");

			let table: KustoTable;
			try {
				const csl = subConfig.csl.replaceAll("{{days}}", String(days));
				table = await runKustoQuery(
					pi,
					cmd.cluster,
					cmd.authResource ?? DEFAULT_AUTH_RESOURCE,
					cmd.loginHint,
					subConfig.db,
					csl,
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(message, "error");
				return;
			}

			const total = costTotal(table);
			const title = subConfig.title ?? sub;
			const heading = `**${title}** · last ${days}d${total ? ` · total ${total}` : ""}`;
			const message = `${heading}\n\n${formatTable(table)}`;

			pi.sendMessage({
				customType: "kusto-command",
				content: [{ type: "text", text: message }],
				display: "user",
			});
		},
	});
}

export default function (pi: ExtensionAPI) {
	const config = loadConfig();
	if (!config) return;

	for (const cmd of config.commands) {
		if (!cmd?.name || !cmd.cluster || !cmd.subcommands) continue;
		registerCommand(pi, cmd);
	}
}
