/**
 * Doubao realtime duplex protocol (Seeduplex / full-duplex).
 *
 * Design:
 * - Standard event names on the wire (`session.create`, `input_audio_buffer.append`, ...)
 * - Structured `session` fields (`audio.input` / `audio.output` / `instructions` / `tools`)
 * - Vendor-specific ASR/TTS/dialog capability stays in `extension` (StartSessionPayload shape)
 * - Pure JSON text frames; audio is Base64 in `audio` / `delta`
 */

export const DOUBAO_DUPLEX_MODEL = "1.2.6.1";
export const DOUBAO_DUPLEX_WS_URL = "wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue";

/** Opaque JSON object for StartSessionPayload passthrough. */
export type JsonObject = Record<string, unknown>;

// 客户端事件类型
export type ClientEventType =
	| "session.create"
	| "session.update"
	| "session.close"
	| "input_audio_buffer.append"
	| "input_audio_buffer.commit"
	| "input_audio_mute.commit"
	| "input_audio_unmute.commit"
	| "speech_text_buffer.commit"
	| "speech_text_buffer.replacement.append"
	| "speech_text_buffer.replacement.commit"
	| "conversation.item.create"
	| "conversation.item.update"
	| "conversation.item.retrieve"
	| "conversation.item.delete"
	| "response.cancel";

// 服务端事件类型
export type ServerEventType =
	| "session.created"
	| "session.updated"
	| "session.closed"
	| "input_audio_buffer.committed"
	| "conversation.item.input_audio_transcription.started"
	| "conversation.item.input_audio_transcription.delta"
	| "conversation.item.input_audio_transcription.completed"
	| "conversation.item.input_audio_transcription.failed"
	| "response.output_text.delta"
	| "response.output_text.done"
	| "response.output_audio.started"
	| "response.output_audio.delta"
	| "response.output_audio.done"
	| "conversation.item.added"
	| "conversation.item.retrieved"
	| "conversation.item.deleted"
	| "response.function_call_arguments.done"
	| "response.done"
	| "response.canceled"
	| "error";

// 对话角色
export type ConversationRole = "user" | "assistant" | "tool";

// 音频输入格式
export type AudioInputFormat = {
	type: "pcm" | "speech_opus";
	/** Input sample rate in Hz. Duplex API currently requires 16000. */
	rate: 16000;
};

// 音频输出格式
export type AudioOutputFormat = {
	type: "pcm" | "ogg_opus";
	/** Output sample rate in Hz. Duplex API currently requires 24000. */
	rate: 24000;
};

// 会话音频配置
export type SessionAudioConfig = {
	input: {
		format: AudioInputFormat;
	};
	output: {
		format: AudioOutputFormat;
		/** Required voice / speaker id. */
		voice: string;
		/** Speed in [-50, 100]. Default 0. */
		speed?: number;
		/** Loudness in [-50, 100]. Default 0. */
		loudness?: number;
	};
};

// 功能工具定义
export type FunctionToolDefinition = {
	type: "function";
	name: string;
	description?: string;
	parameters?: JsonObject;
};

/**
 * Vendor-specific payload. Shape matches the legacy end-to-end StartSessionPayload
 * fields `asr` / `tts` / `dialog` so existing configs can be moved in unchanged.
 */
// 会话拓展
export type SessionExtension = {
	asr?: JsonObject;
	tts?: JsonObject;
	dialog?: JsonObject;
};

// 会话配置
export type SessionConfig = {
	/** Resume id (legacy dialog.id). Omit on a fresh session. */
	id?: string;
	/** Fixed duplex model id. */
	model: typeof DOUBAO_DUPLEX_MODEL;
	instructions?: string;
	audio: SessionAudioConfig;
	tools?: FunctionToolDefinition[];
};
// 客户端事件基类
export type ClientEventBase = {
	type: ClientEventType;
	/** Recommended for tracing and request/response matching. */
	event_id?: string;
};

// 会话创建事件
export type SessionCreateEvent = ClientEventBase & {
	type: "session.create";
	session: SessionConfig;
	extension?: SessionExtension;
};

// 会话更新事件
export type SessionUpdateEvent = ClientEventBase & {
	type: "session.update";
	session: Partial<SessionConfig> & {
		audio?: SessionAudioConfig;
	};
	extension?: SessionExtension;
};

// 会话关闭事件
export type SessionCloseEvent = ClientEventBase & {
	type: "session.close";
};

// 输入音频缓冲区追加事件
export type InputAudioBufferAppendEvent = ClientEventBase & {
	type: "input_audio_buffer.append";
	/** Base64-encoded audio chunk. Prefer ~20ms frames (640 bytes at 16 kHz s16le). */
	audio: string;
};

// 输入音频缓冲区提交事件
export type InputAudioBufferCommitEvent = ClientEventBase & {
	type: "input_audio_buffer.commit";
};

// 输入音频静音提交事件
export type InputAudioMuteCommitEvent = ClientEventBase & {
	type: "input_audio_mute.commit";
};

// 输入音频取消静音提交事件
export type InputAudioUnmuteCommitEvent = ClientEventBase & {
	type: "input_audio_unmute.commit";
};

// 语音文本缓冲区提交事件
export type SpeechTextBufferCommitEvent = ClientEventBase & {
	type: "speech_text_buffer.commit";
	text: string;
};
// 语音文本缓冲区替换追加事件
export type SpeechTextReplacementAppendEvent = ClientEventBase & {
	type: "speech_text_buffer.replacement.append";
	text: string;
};

// 语音文本缓冲区替换提交事件
export type SpeechTextReplacementCommitEvent = ClientEventBase & {
	type: "speech_text_buffer.replacement.commit";
	text?: string;
};

// 对话消息内容
export type ConversationMessageContent =
	| {
			type: "input_text" | "text";
			text: string;
	  }
	| JsonObject;

// 对话消息项目
export type ConversationMessageItem = {
	id?: string;
	type: "message";
	role: Exclude<ConversationRole, "tool">;
	content: ConversationMessageContent[];
};

// 对话工具结果项目
export type ConversationToolResultItem = {
	id?: string;
	/** Function-call result item; paired with response.function_call_arguments.done.call_id. */
	call_id: string;
	role: "tool";
	content: Array<{
		type: "input_text";
		text: string;
	}>;
};

// 对话项目创建事件
export type ConversationItemCreateEvent = ClientEventBase & {
	type: "conversation.item.create";
	items: Array<ConversationMessageItem | ConversationToolResultItem>;
};

// 对话项目更新事件
export type ConversationItemUpdateEvent = ClientEventBase & {
	type: "conversation.item.update";
	items: Array<{
		id: string;
		content: ConversationMessageContent[];
	}>;
};

// 对话项目检索事件
export type ConversationItemRetrieveEvent = ClientEventBase & {
	type: "conversation.item.retrieve";
	items?: Array<{
		id?: string;
	}>;
};

export type ConversationItemDeleteEvent = ClientEventBase & {
	type: "conversation.item.delete";
	items: Array<{
		id: string;
	}>;
};

export type ResponseCancelEvent = ClientEventBase & {
	type: "response.cancel";
};

export type ClientEvent =
	| SessionCreateEvent
	| SessionUpdateEvent
	| SessionCloseEvent
	| InputAudioBufferAppendEvent
	| InputAudioBufferCommitEvent
	| InputAudioMuteCommitEvent
	| InputAudioUnmuteCommitEvent
	| SpeechTextBufferCommitEvent
	| SpeechTextReplacementAppendEvent
	| SpeechTextReplacementCommitEvent
	| ConversationItemCreateEvent
	| ConversationItemUpdateEvent
	| ConversationItemRetrieveEvent
	| ConversationItemDeleteEvent
	| ResponseCancelEvent;

export type ServerEventBase = {
	type: ServerEventType;
	event_id?: string;
};

export type SessionCreatedEvent = ServerEventBase & {
	type: "session.created";
	session: {
		id: string;
	};
};

export type SessionUpdatedEvent = ServerEventBase & {
	type: "session.updated";
	session?: JsonObject;
};

export type SessionClosedEvent = ServerEventBase & {
	type: "session.closed";
};

export type InputAudioBufferCommittedEvent = ServerEventBase & {
	type: "input_audio_buffer.committed";
};

export type TranscriptionStartedEvent = ServerEventBase & {
	type: "conversation.item.input_audio_transcription.started";
};

export type TranscriptionDeltaEvent = ServerEventBase & {
	type: "conversation.item.input_audio_transcription.delta";
	delta?: string;
	text?: string;
};

export type TranscriptionCompletedEvent = ServerEventBase & {
	type: "conversation.item.input_audio_transcription.completed";
	transcript?: string;
	text?: string;
};

export type TranscriptionFailedEvent = ServerEventBase & {
	type: "conversation.item.input_audio_transcription.failed";
	error?: JsonObject;
};

export type OutputTextDeltaEvent = ServerEventBase & {
	type: "response.output_text.delta";
	delta?: string;
	text?: string;
};

export type OutputTextDoneEvent = ServerEventBase & {
	type: "response.output_text.done";
	text?: string;
};

export type OutputAudioStartedEvent = ServerEventBase & {
	type: "response.output_audio.started";
	tts_type?: "audit_content_risky" | "chat_tts_text" | "network" | "default" | string;
};

export type OutputAudioDeltaEvent = ServerEventBase & {
	type: "response.output_audio.delta";
	/** Base64-encoded PCM/Ogg Opus chunk. */
	delta: string;
};

export type OutputAudioDoneEvent = ServerEventBase & {
	type: "response.output_audio.done";
	/** `20000002` means the model detected a user exit intent. */
	status_code?: string | number;
};

export type ConversationItemAddedEvent = ServerEventBase & {
	type: "conversation.item.added";
	items?: JsonObject[];
};

export type ConversationItemRetrievedEvent = ServerEventBase & {
	type: "conversation.item.retrieved";
	items?: JsonObject[];
};

export type ConversationItemDeletedEvent = ServerEventBase & {
	type: "conversation.item.deleted";
	items?: JsonObject[];
	status_code?: number;
	message?: string;
};

export type FunctionCallArgumentsDoneEvent = ServerEventBase & {
	type: "response.function_call_arguments.done";
	items?: Array<{
		call_id: string;
		name: string;
		arguments: string;
	}>;
};

export type ResponseDoneEvent = ServerEventBase & {
	type: "response.done";
	usage?: JsonObject;
};

export type ResponseCanceledEvent = ServerEventBase & {
	type: "response.canceled";
};

export type ErrorServerEvent = ServerEventBase & {
	type: "error";
	status_code?: string | number;
	message?: string;
	error?: JsonObject;
};

export type ServerEvent =
	| SessionCreatedEvent
	| SessionUpdatedEvent
	| SessionClosedEvent
	| InputAudioBufferCommittedEvent
	| TranscriptionStartedEvent
	| TranscriptionDeltaEvent
	| TranscriptionCompletedEvent
	| TranscriptionFailedEvent
	| OutputTextDeltaEvent
	| OutputTextDoneEvent
	| OutputAudioStartedEvent
	| OutputAudioDeltaEvent
	| OutputAudioDoneEvent
	| ConversationItemAddedEvent
	| ConversationItemRetrievedEvent
	| ConversationItemDeletedEvent
	| FunctionCallArgumentsDoneEvent
	| ResponseDoneEvent
	| ResponseCanceledEvent
	| ErrorServerEvent
	| (ServerEventBase & JsonObject);

export type DoubaoRealtimeEvent = ClientEvent | ServerEvent;

export function createDefaultSessionConfig(options: {
	voice: string;
	instructions?: string;
	sessionId?: string;
	tools?: FunctionToolDefinition[];
}): SessionConfig {
	return {
		id: options.sessionId,
		model: DOUBAO_DUPLEX_MODEL,
		instructions: options.instructions,
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
				voice: options.voice,
				speed: 0,
				loudness: 0,
			},
		},
		tools: options.tools,
	};
}

export function createSessionCreateEvent(options: {
	session: SessionConfig;
	extension?: SessionExtension;
	eventId?: string;
}): SessionCreateEvent {
	return {
		type: "session.create",
		event_id: options.eventId,
		session: options.session,
		extension: options.extension,
	};
}

export function createInputAudioAppendEvent(audioBase64: string, eventId?: string): InputAudioBufferAppendEvent {
	return {
		type: "input_audio_buffer.append",
		event_id: eventId,
		audio: audioBase64,
	};
}

export function encodePcmChunkToBase64(chunk: Buffer): string {
	return chunk.toString("base64");
}

export function decodeBase64Audio(delta: string): Buffer {
	return Buffer.from(delta, "base64");
}

export function parseServerEvent(raw: string): ServerEvent {
	const parsed: unknown = JSON.parse(raw);
	if (typeof parsed !== "object" || parsed === null || !("type" in parsed) || typeof parsed.type !== "string") {
		throw new Error("Invalid Doubao realtime server event: missing type");
	}
	// 解析服务端事件
	return parsed as ServerEvent;
}

export function serializeClientEvent(event: ClientEvent): string {
	return JSON.stringify(event);
}
