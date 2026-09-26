import fs from "node:fs";
import { getDebugLogPath } from "../config.ts";

let debugEnabled = true;

export function setDebugEnabled(enabled: boolean): void {
	debugEnabled = enabled;
}

export function isDebugEnabled(): boolean {
	return debugEnabled;
}

/** Append a line to `<agent-dir>/pi-debug.log` when debug is enabled. */
export function debugInfo(message: string): void {
	if (!debugEnabled) return;
	const path = getDebugLogPath();
	fs.appendFileSync(path, message + "\n");
}
