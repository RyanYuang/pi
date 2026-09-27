import { type ChildProcess, spawn } from "node:child_process";
import { debugInfo } from "@earendil-works/pi-coding-agent/utils/debug";

export type AudioChunkHandler = (chunk: Buffer) => void;

export interface recorder {
	start(onAudio?: AudioChunkHandler): void;
	stop(): void;
}

export class Recorder implements recorder {
	private static instance: Recorder | undefined;
	private process: ChildProcess | undefined;
	private onAudio: AudioChunkHandler | undefined;

	static getInstance(): Recorder {
		if (Recorder.instance) {
			return Recorder.instance;
		}
		Recorder.instance = new Recorder();
		return Recorder.instance;
	}

	private constructor() {}

	start(onAudio?: AudioChunkHandler): void {
		if (this.process && this.process.exitCode === null) {
			debugInfo("Recorder already running");
			return;
		}

		this.onAudio = onAudio;
		debugInfo("Starting recorder (raw s16le PCM @16kHz on stdout)");
		// Open the mic at its native rate, then resample to 16 kHz for Doubao uplink.
		// Output `-r 16000` plus the `rate` effect avoids the macOS footgun where SoX
		// falls back to 24 kHz capture but still labels the stream as 16 kHz.
		this.process = spawn(
			"rec",
			["-q", "-c", "1", "-b", "16", "-e", "signed-integer", "-t", "raw", "-r", "16000", "-", "rate", "16000"],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);

		this.process.stdout?.on("data", (chunk: Buffer) => {
			this.onAudio?.(chunk);
		});

		this.process.stderr?.on("data", (data: Buffer) => {
			debugInfo(data.toString("utf-8").trimEnd());
		});

		this.process.on("exit", (code, signal) => {
			debugInfo(`Recorder exited code=${String(code)} signal=${String(signal)}`);
			this.process = undefined;
			this.onAudio = undefined;
		});

		this.process.on("error", (error) => {
			debugInfo(`Recorder failed to start: ${error.message}`);
			this.process = undefined;
			this.onAudio = undefined;
		});
	}

	stop(): void {
		const child = this.process;
		if (!child || child.exitCode !== null) {
			debugInfo("Recorder already stopped");
			return;
		}
		debugInfo("Stopping recorder");
		child.kill("SIGINT");
	}

	getProcessState(): "running" | "stopped" {
		if (this.process && this.process.exitCode === null) {
			return "running";
		}
		return "stopped";
	}
}
