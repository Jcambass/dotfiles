/**
 * Best-effort cmux pane integration for the subagent tool.
 *
 * Splits new panes directly into the CURRENT cmux workspace/session — the
 * same one the running pi conversation already lives in. Deliberately never
 * calls `cmux new-workspace`: a cmux workspace is a persistent session (it
 * carries its own env vars, todo checklist, status, connection state), not
 * a disposable tab. Subagent panes must stay inside the caller's existing
 * session; only new panes (splits) are created there.
 *
 * Every step here is best-effort: any failure returns null/no-ops instead of
 * throwing. Panes are a bonus; they must never block or fail agent execution.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isCmux, shellQuote, sleep } from "./cmux.js";

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
	slots: PaneSlot[];
}

/**
 * Split off `slotCount` new panes stacked in a column next to the anchor
 * surface (the pane the live pi conversation is running in). The anchor
 * itself is never reused or written to — only ever the split origin.
 */
async function splitColumn(
	pi: ExtensionAPI,
	workspaceRef: string,
	anchorSurfaceRef: string,
	slotCount: number,
): Promise<string[]> {
	const refs: string[] = [];
	let fromSurface = anchorSurfaceRef;
	for (let i = 0; i < slotCount; i++) {
		const direction = i === 0 ? "right" : "down";
		const result = await pi.exec("cmux", [
			"new-split", direction, "--surface", fromSurface, "--workspace", workspaceRef,
		]);
		if (result.code !== 0) break;
		const ref = extractSurfaceRef(result.stdout || result.stderr || "");
		if (!ref) break;
		refs.push(ref);
		fromSurface = ref;
	}
	return refs;
}

/**
 * Split one pane per slot into the current cmux workspace, each tailing its
 * own log file. Returns null (no-op for callers) when not in cmux, when the
 * current workspace/surface can't be identified from the environment, or on
 * any failure.
 */
export async function openPaneRun(
	pi: ExtensionAPI,
	opts: { slotCount: number },
): Promise<PaneRun | null> {
	if (!isCmux()) return null;
	const workspaceRef = process.env.CMUX_WORKSPACE_ID;
	const anchorSurfaceRef = process.env.CMUX_SURFACE_ID;
	if (!workspaceRef || !anchorSurfaceRef) return null;

	const slotCount = Math.max(1, Math.min(MAX_SLOTS, opts.slotCount));

	try {
		const surfaceRefs = await splitColumn(pi, workspaceRef, anchorSurfaceRef, slotCount);
		if (surfaceRefs.length === 0) return null;

		const logDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-panes-"));
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

		return { slots };
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

/** Label a pane's tab with the agent currently occupying that slot. */
export function renamePaneTab(pi: ExtensionAPI, slot: PaneSlot | undefined, label: string): void {
	if (!slot) return;
	pi.exec("cmux", ["rename-tab", "--surface", slot.surfaceRef, label]).catch(() => {
		// best-effort
	});
}

/**
 * Close log streams. Leaves the panes open in your current workspace so
 * you can review the output or close them yourself — cmux's CLI refuses to
 * close the last surface in a pane (`close-surface` -> `invalid_state:
 * Cannot close the last surface`), and every subagent pane has exactly one
 * surface, so there is no CLI-level way to auto-remove them anyway.
 */
export function closePaneRun(_pi: ExtensionAPI, run: PaneRun | null | undefined): void {
	if (!run) return;
	for (const slot of run.slots) {
		try {
			slot.stream.end();
		} catch {
			// best-effort
		}
	}
}
