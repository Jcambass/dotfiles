/**
 * Pi Status Registry Extension
 *
 * Publishes the current Pi session's status-panel state to a process-local
 * registry. The cmux Dock control (`status-dock.sh`) reads this registry and
 * renders `status-panel.sh` in the native cmux Dock/right sidebar for the
 * currently selected workspace.
 *
 * Child subagents can disable mux UI with PI_DISABLE_MUX_UI=1.
 */

import { accessSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface StatusRegistryEntry {
	pid: number;
	cwd: string;
	sessionDir: string;
	sessionFile?: string;
	workspaceId?: string;
	updatedAt: number;
}

function truthyEnv(value: string | undefined): boolean {
	const normalized = value?.toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isMuxUiDisabled(): boolean {
	return truthyEnv(process.env.PI_DISABLE_MUX_UI);
}

function getRegistryFile(): string {
	return path.join(os.tmpdir(), "pi-status-registry.json");
}

function getStateDir(sessionFile: string | undefined): string {
	if (sessionFile) {
		return path.dirname(sessionFile);
	}

	const ephemeralDir = path.join(os.tmpdir(), `pi-session-${process.pid}`);
	try {
		mkdirSync(ephemeralDir, { recursive: true });
	} catch {}
	return ephemeralDir;
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readRegistry(): StatusRegistryEntry[] {
	try {
		const raw = readFileSync(getRegistryFile(), "utf-8");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed?.entries) ? parsed.entries : [];
	} catch {
		return [];
	}
}

function writeRegistry(entries: StatusRegistryEntry[]): void {
	try {
		writeFileSync(getRegistryFile(), JSON.stringify({ entries }, null, 2), "utf-8");
	} catch {}
}

function pruneRegistry(entries: StatusRegistryEntry[]): StatusRegistryEntry[] {
	const cutoff = Date.now() - 24 * 60 * 60 * 1000;
	return entries.filter((entry) => {
		if (entry.pid === process.pid) return true;
		if ((entry.updatedAt ?? 0) < cutoff) return false;
		return isProcessAlive(entry.pid);
	});
}

function fileExists(filePath: string): boolean {
	try {
		accessSync(filePath);
		return true;
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	let currentEntry: StatusRegistryEntry | null = null;
	let refreshTimer: ReturnType<typeof setInterval> | null = null;

	function publish(cwd: string, sessionFile: string | undefined): void {
		if (isMuxUiDisabled()) return;

		const sessionDir = getStateDir(sessionFile);
		const statusPanelScript = path.join(os.homedir(), ".pi", "agent", "extensions", "status-panel.sh");
		if (!fileExists(statusPanelScript)) return;

		currentEntry = {
			pid: process.pid,
			cwd,
			sessionDir,
			...(sessionFile ? { sessionFile } : {}),
			...(process.env.CMUX_WORKSPACE_ID ? { workspaceId: process.env.CMUX_WORKSPACE_ID } : {}),
			updatedAt: Date.now(),
		};

		const entries = pruneRegistry(readRegistry()).filter((entry) => entry.pid !== process.pid);
		entries.push(currentEntry);
		writeRegistry(entries);
	}

	function refresh(): void {
		if (!currentEntry || isMuxUiDisabled()) return;
		publish(currentEntry.cwd, currentEntry.sessionFile);
	}

	function startRefreshTimer(): void {
		if (refreshTimer) return;
		refreshTimer = setInterval(refresh, 5000);
		refreshTimer.unref?.();
	}

	function removeCurrentEntry(): void {
		const entries = pruneRegistry(readRegistry()).filter((entry) => entry.pid !== process.pid);
		writeRegistry(entries);
		currentEntry = null;
	}

	pi.on("session_start", async (_event, ctx) => {
		publish(ctx.cwd, ctx.sessionManager.getSessionFile());
		startRefreshTimer();
	});

	pi.on("session_switch", async (_event, ctx) => {
		publish(ctx.cwd, ctx.sessionManager.getSessionFile());
		startRefreshTimer();
	});

	pi.on("session_tree", async (_event, ctx) => {
		publish(ctx.cwd, ctx.sessionManager.getSessionFile());
	});

	pi.on("session_shutdown", async () => {
		if (refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = null;
		}
		removeCurrentEntry();
	});

	process.on("exit", removeCurrentEntry);
}
