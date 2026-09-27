import { type ServerEvent } from "./Doubao_realtime_conversation/doubao-realtime-protocol.ts";
import { DoubaoP2PConversation, type DoubaoP2PConnectOptions } from "./Doubao_realtime_conversation/doubao_realtime_conversation.ts";
import { debugInfo } from "@earendil-works/pi-coding-agent/utils/debug";
import { Recorder } from "./recorder.ts";
import { Player } from "./player.ts";

export class RealtimeConversation {
	private static instance: RealtimeConversation | undefined;

	private conversation = new DoubaoP2PConversation({
		onEvent: (event) => this.handleServerEvent(event),
		onError: (error) => this.handleError(error),
		onClose: () => this.handleTransportClose(),
	});

	/** Local TTS playback in progress (does not pause mic uplink). */
	private isPlaying = false;
	/** True between session.created and session.closed / transport close. */
	private sessionActive = false;

	static getInstance(): RealtimeConversation {
		if (!RealtimeConversation.instance) {
			RealtimeConversation.instance = new RealtimeConversation();
		}
		return RealtimeConversation.instance;
	}

	start(): void {
		const apiKey = process.env.DOUBAO_API_KEY;
		if (!apiKey) {
			throw new Error("DOUBAO_API_KEY is required to start RealtimeConversation");
		}
		const connectOptions: DoubaoP2PConnectOptions = {
			url: "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue",
			headers: {
				"X-Api-Key": apiKey,
			},
			session: {
				model: "1.2.6.1",
				audio: {
					input: {
						format: {
							type: "pcm",
							rate: 16000,
						},
					},
					output: {
						format: {
							type: "pcm",
							rate: 24000,
						},
						voice: "zh_female_vv_jupiter_bigtts",
						speed: 0,
						loudness: 0,
					},
				},
			},
			extension: {
				asr: {},
				tts: {
					audio_config: {
						format: "pcm_s16le",
						sample_rate: 24000,
						channel: 1,
					},
				},
				dialog: {},
			},
		};
		this.conversation.connect(connectOptions);
	}

	/**
	 * Keep uploading mic PCM for the whole session.
	 * Doubao times out (AudioTTSIdleTimeoutError / 52000016) if uplink stops
	 * without input_audio_mute.commit — see access-mustread.
	 */
	private AudioChunkHandler(chunk: Buffer): void {
		if (!this.sessionActive || !this.conversation.isConnected()) {
			return;
		}
		this.conversation.appendAudio(chunk);
	}

	private endSessionLocally(): void {
		this.sessionActive = false;
		this.isPlaying = false;
		Recorder.getInstance().stop();
		Player.getInstance().stop();
	}

	private handleTransportClose(): void {
		this.endSessionLocally();
	}

	private handleServerEvent(event: ServerEvent): void {
		debugInfo(`Server event: ${JSON.stringify(event)}`);
		switch (event.type) {
			case "session.created":
				this.sessionActive = true;
				debugInfo(`Session created: ${JSON.stringify(event.session)}`);
				Recorder.getInstance().start((chunk) => this.AudioChunkHandler(chunk));
				break;
			case "session.closed":
				this.endSessionLocally();
				break;
			case "error": {
				const message =
					typeof event.error === "object" && event.error && "message" in event.error
						? String((event.error as { message?: unknown }).message)
						: event.message;
				debugInfo(`Server error: ${message ?? JSON.stringify(event)}`);
				// Idle/session errors are followed by session.closed; stop uplink immediately
				// so we do not send appendAudio after the session is gone.
				if (typeof message === "string" && /IdleTimeout|no session active/i.test(message)) {
					this.endSessionLocally();
				}
				break;
			}
			case "response.output_audio.started":
				this.isPlaying = true;
				Player.getInstance().start();
				break;
			case "conversation.item.input_audio_transcription.started":
				// Barge-in: stop local TTS and cancel the in-flight model response.
				this.isPlaying = false;
				Player.getInstance().stop();
				this.conversation.send({ type: "response.cancel" });
				break;
			case "response.output_audio.delta": {
				if (!this.isPlaying) break;
				if (typeof event.delta !== "string") break;
				Player.getInstance().write(Buffer.from(event.delta, "base64"));
				break;
			}
			case "response.output_audio.done":
				this.isPlaying = false;
				break;
		}
	}

	private handleError(error: Error): void {
		debugInfo(`Error: ${error.message}`);
		if (error.cause !== undefined) {
			debugInfo(`Error cause: ${String(error.cause)}`);
		}
	}
}
