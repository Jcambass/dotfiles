/**
 * Best-effort cmux pane integration for the subagent tool.
 *
 * Opens a dedicated cmux tab (workspace) with one pane per concurrency slot,
 * so a human can watch subagents live in addition to — not instead of — the
 * structured NDJSON stream the subagent tool already parses for the model.
 *
 * Every step here is best-effort: any failure returns null/no-ops instead of
 * throwing. Panes are a bonus; they must never block or fail agent execution.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { extractWorkspaceRef, isCmux, shellQuote, sleep } from "./cmux.js";

/** Matches the subagent tool's own MAX_PARALLEL/MAX_CONCURRENCY ceiling. */
const MAX_SLOTS = 4;

export function extractSurfaceRef(output: string): string | null {
	const match = output.match(/surface:(\S+)/);
	return match ? `surface:${match[1]}` : null;
}

export interface PaneSlot {
	surfaceRef: string;
	logPath: string;
	stream: fs.WriteStream;
}

export interface PaneRun {
	workspaceRef: string;
	slots: PaneSlot[];
}

/**
 * Fixed 2x2 grid plan for up to MAX_SLOTS panes, built from a base surface:
 * top-left (given) -> top-right (split right) -> bottom-left (split down
 * from top-left) -> bottom-right (split down from top-right).
 */
async function buildGrid(
	pi: ExtensionAPI,
	workspaceRef: string,
	firstSurfaceRef: string,
	slotCount: number,
): Promise<string[]> {
	const refs = [firstSurfaceRef];
	if (slotCount < 2) return refs;

	const split = async (direction: string, fromSurface: string): Promise<string | null> => {
		const result = await pi.exec("cmux", [
			"new-split", direction, "--surface", fromSurface, "--workspace", workspaceRef,
		]);
		if (result.code !== 0) return null;
		return extractSurfaceRef(result.stdout || result.stderr || "");
	};

	const topRight = await split("right", firstSurfaceRef);
	if (topRight) refs.push(topRight);
	if (slotCount < 3 || !topRight) return refs;

	const bottomLeft = await split("down", firstSurfaceRef);
	if (bottomLeft) refs.push(bottomLeft);
	if (slotCount < 4 || !bottomLeft) return refs;

	const bottomRight = await split("down", topRight);
	if (bottomRight) refs.push(bottomRight);

	return refs;
}

/**
 * Open a dedicated cmux tab with one pane per slot, each tailing its own log
 * file. Returns null (no-op for callers) when not in cmux or on any failure.
 *
 * Deliberately does NOT use the caller's project/worktree path as the
 * workspace's cwd. workstreams.ts resolves "is this workstream open in
 * cmux" (and /ws's open/switch target) by matching a live cmux workspace's
 * cwd against the worktree path (`findWorkspaceForPath` in lib/cmux.ts). If
 * this scratch tab used that same path, it would collide with the real
 * workstream's workspace and /ws could switch you into this throwaway
 * monitoring tab instead of your actual coding session. Its own log
 * directory is an unrelated path, so it can never match.
 */
export async function openPaneRun(
	pi: ExtensionAPI,
	opts: { title: string; slotCount: number },
): Promise<PaneRun | null> {
	if (!isCmux()) return null;
	const slotCount = Math.max(1, Math.min(MAX_SLOTS, opts.slotCount));

	try {
		const logDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-panes-"));

		const createResult = await pi.exec("cmux", [
			"new-workspace", "--name", opts.title, "--cwd", logDir, "--focus", "false",
		]);
		if (createResult.code !== 0) return null;
		const workspaceRef = extractWorkspaceRef(createResult.stdout || createResult.stderr || "");
		if (!workspaceRef) return null;

		const treeResult = await pi.exec("cmux", ["tree", "--workspace", workspaceRef]);
		const firstSurfaceRef = extractSurfaceRef(treeResult.stdout || "");
		if (!firstSurfaceRef) return null;

		const surfaceRefs = await buildGrid(pi, workspaceRef, firstSurfaceRef, slotCount);

		const slots: PaneSlot[] = [];
		for (let i = 0; i < surfaceRefs.length; i++) {
			const logPath = path.join(logDir, `slot-${i}.log`);
			await fs.promises.writeFile(logPath, "waiting for an agent…\n", "utf-8");
			const stream = fs.createWriteStream(logPath, { flags: "a" });
			slots.push({ surfaceRef: surfaceRefs[i], logPath, stream });

			await pi.exec("cmux", ["send", "--surface", surfaceRefs[i], `tail -n +1 -f ${shellQuote(logPath)}`]);
			await sleep(120);
			await pi.exec("cmux", ["send-key", "--surface", surfaceRefs[i], "enter"]);
			await sleep(120);
		}

		if (slots.length === 0) return null;
		return { workspaceRef, slots };
	} catch {
		return null;
	}
}

export function writePaneLine(slot: PaneSlot | undefined, text: string): void {
	if (!slot) return;
	try {
		slot.stream.write(text.endsWith("\n") ? text : `${text}\n`);
	} catch {
		// best-effort — never let pane bookkeeping break agent execution
	}
}

/** Close log streams. Leaves the cmux tab/panes open for the user to review. */
export function closePaneRun(run: PaneRun | null | undefined): void {
	if (!run) return;
	for (const slot of run.slots) {
		try {
			slot.stream.end();
		} catch {
			// best-effort
		}
	}
}
