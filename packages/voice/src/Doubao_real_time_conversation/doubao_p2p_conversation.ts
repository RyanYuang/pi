import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import {
	type ClientEvent,
	createInputAudioAppendEvent,
	createSessionCreateEvent,
	DOUBAO_DUPLEX_WS_URL,
	encodePcmChunkToBase64,
	parseServerEvent,
	type ServerEvent,
	type SessionConfig,
	type SessionExtension,
	serializeClientEvent,
} from "./doubao-realtime-protocol.ts";

/** Convert a WebSocket raw data to a UTF-8 string. */
function rawDataToUtf8(data: RawData): string {
	if (typeof data === "string") return data;
	if (Buffer.isBuffer(data)) return data.toString("utf-8");
	if (Array.isArray(data)) return Buffer.concat(data).toString("utf-8");
	return Buffer.from(data).toString("utf-8");
}

/** Handlers for DoubaoP2PConversation events. */
export type DoubaoP2PConversationHandlers = {
	onEvent?: (event: ServerEvent) => void;
	onError?: (error: Error) => void;
	onClose?: () => void;
	onOpen?: () => void;
};

/** Options for connecting to DoubaoP2PConversation. */
export type DoubaoP2PConnectOptions = {
	url?: string;
	headers?: Record<string, string>;
	session: SessionConfig;
	/** Legacy StartSessionPayload fields, passed through unchanged. */
	extension?: SessionExtension;
};

/**
 * WebSocket transport for Doubao duplex realtime dialogue.
 * Sends/receives pure JSON text frames; audio is Base64 inside event fields.
 */
export class DoubaoP2PConversation {
	private ws: WebSocket | undefined;
	private onEvent: (event: ServerEvent) => void;
	private onError: (error: Error) => void;
	private onClose: () => void;
	private onOpen: () => void;

	/** Initialize a DoubaoP2PConversation with event handlers. */
	constructor(handlers: DoubaoP2PConversationHandlers = {}) {
		this.onEvent = handlers.onEvent ?? (() => {});
		this.onError = handlers.onError ?? (() => {});
		this.onClose = handlers.onClose ?? (() => {});
		this.onOpen = handlers.onOpen ?? (() => {});
	}

	/** Connect to DoubaoP2PConversation. */
	connect(options: DoubaoP2PConnectOptions): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			throw new Error("DoubaoP2PConversation is already connected");
		}
        // 如果未提供 URL，则使用默认 URL
		const url = options.url ?? DOUBAO_DUPLEX_WS_URL;
		// 创建 WebSocket 连接
		this.ws = new WebSocket(url, {
			headers: options.headers,
		});
		// 当 WebSocket 连接打开时，发送会话创建事件
		this.ws.on("open", () => {
			this.onOpen();
			this.send(
				createSessionCreateEvent({
					session: options.session,
					extension: options.extension,
					eventId: randomUUID(),
				}),
			);
		});
		// 当收到 WebSocket 消息时，解析服务端事件
		this.ws.on("message", (data, isBinary) => {
			if (isBinary) {
				this.onError(new Error("Unexpected binary WebSocket frame; duplex protocol uses JSON text only"));
				return;
			}
			try {
				const text = rawDataToUtf8(data);
				this.onEvent(parseServerEvent(text));
			} catch (error) {
				this.onError(error instanceof Error ? error : new Error(String(error)));
			}
		});
		// 当 WebSocket 连接错误时，处理错误
		this.ws.on("error", (error) => {
			this.onError(error);
		});
		// 当 WebSocket 连接关闭时，清理连接状态
		this.ws.on("close", () => {
			this.ws = undefined;
			this.onClose();
		});
	}

	/** Append one PCM chunk as Base64 `input_audio_buffer.append`. */
	appendAudio(chunk: Buffer): void {
		this.send(createInputAudioAppendEvent(encodePcmChunkToBase64(chunk), randomUUID()));
	}

	send(event: ClientEvent): void {
		const ws = this.ws;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			throw new Error("DoubaoP2PConversation is not connected");
		}
		ws.send(serializeClientEvent(event));
	}

	close(): void {
		const ws = this.ws;
		if (!ws) return;
		if (ws.readyState === WebSocket.OPEN) {
			this.send({
				type: "session.close",
				event_id: randomUUID(),
			});
		}
		ws.close();
	}
}
