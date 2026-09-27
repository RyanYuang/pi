import { type ChildProcess, spawn } from "node:child_process";
import { debugInfo } from "@earendil-works/pi-coding-agent/utils/debug";

interface player {
	start(): void;
	stop(): void;
	write(pcm: Buffer): void;
}

type PcmEncoding = "s16le" | "f32le";

/** Convert float32 LE PCM (-1..1) to int16 LE. */
function float32ToS16le(input: Buffer): Buffer {
	const sampleCount = Math.floor(input.length / 4);
	const output = Buffer.allocUnsafe(sampleCount * 2);
	for (let i = 0; i < sampleCount; i++) {
		const sample = Math.max(-1, Math.min(1, input.readFloatLE(i * 4)));
		output.writeInt16LE((sample * 0x7fff) | 0, i * 2);
	}
	return output;
}

/**
 * Heuristic: Doubao `pcm` may be float32; `pcm_s16le` is int16.
 * Float samples for speech almost always stay within ~[-1.5, 1.5].
 */
function detectPcmEncoding(chunk: Buffer): PcmEncoding {
	if (chunk.length >= 4 && chunk.toString("ascii", 0, 4) === "OggS") {
		throw new Error("Received Ogg/Opus audio; configure extension.tts.audio_config.format=pcm_s16le");
	}
	if (chunk.length < 16 || chunk.length % 4 !== 0) {
		return "s16le";
	}
	const probeCount = Math.min(64, Math.floor(chunk.length / 4));
	let inFloatRange = 0;
	for (let i = 0; i < probeCount; i++) {
		const value = chunk.readFloatLE(i * 4);
		if (Number.isFinite(value) && Math.abs(value) <= 1.5) {
			inFloatRange++;
		}
	}
	return inFloatRange / probeCount >= 0.9 ? "f32le" : "s16le";
}

/** SoX player for Doubao TTS: always feeds 24 kHz mono s16le. */
export class Player implements player {
	private static instance: Player | undefined;
	private process: ChildProcess | undefined;
	private encoding: PcmEncoding | undefined;
	/** When false, late TTS deltas after barge-in/stop are dropped. */
	private accepting = false;

	static getInstance(): Player {
		if (this.instance) {
			return this.instance;
		}
		this.instance = new Player();
		return this.instance;
	}

	start(): void {
		if (this.process && this.process.exitCode === null) {
			this.accepting = true;
			return;
		}
		this.encoding = undefined;
		this.accepting = true;
		// Device output is always normalized to s16le @ 24 kHz mono LE.
		this.process = spawn(
			"play",
			["-q", "-t", "raw", "-r", "24000", "-c", "1", "-b", "16", "-e", "signed-integer", "-L", "-"],
			{ stdio: ["pipe", "ignore", "pipe"] },
		);
		// play exiting closes stdin; unhandled 'error' becomes process-crashing EPIPE.
		this.process.stdin?.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED") {
				debugInfo(`Player stdin closed: ${error.code}`);
				return;
			}
			debugInfo(`Player stdin error: ${error.message}`);
		});
		this.process.stderr?.on("data", (data: Buffer) => {
			debugInfo(data.toString("utf-8").trimEnd());
		});
		this.process.on("exit", (code, signal) => {
			debugInfo(`Player exited code=${String(code)} signal=${String(signal)}`);
			this.process = undefined;
			this.encoding = undefined;
			this.accepting = false;
		});
		this.process.on("error", (error) => {
			debugInfo(`Player failed to start: ${error.message}`);
			this.process = undefined;
			this.encoding = undefined;
			this.accepting = false;
		});
	}

	stop(): void {
		this.accepting = false;
		const child = this.process;
		this.process = undefined;
		this.encoding = undefined;
		if (!child || child.exitCode !== null) {
			debugInfo("Player already stopped");
			return;
		}
		debugInfo("Stopping player");
		try {
			child.stdin?.end();
		} catch {
			// ignore
		}
		child.kill("SIGINT");
	}

	write(pcm: Buffer): void {
		if (!this.accepting) {
			return;
		}
		if (!this.process || this.process.exitCode !== null) {
			this.start();
		}
		const stdin = this.process?.stdin;
		if (!stdin || stdin.destroyed || !stdin.writable) {
			debugInfo("Player stdin not writable; dropping chunk");
			return;
		}
		if (!this.encoding) {
			this.encoding = detectPcmEncoding(pcm);
			debugInfo(`Player detected PCM encoding=${this.encoding} bytes=${pcm.length}`);
		}
		const s16le = this.encoding === "f32le" ? float32ToS16le(pcm) : pcm;
		if (s16le.length % 2 !== 0) {
			debugInfo(`Dropping misaligned PCM chunk bytes=${s16le.length}`);
			return;
		}
		stdin.write(s16le);
	}

	getProcessState(): "running" | "stopped" {
		if (this.process && this.process.exitCode === null) {
			return "running";
		}
		return "stopped";
	}
}
