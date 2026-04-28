import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

import type {
	ApprovalRequest,
	ConsoleEvent,
	DirectoryListing,
	ModelOption,
	ModelSelection,
	PermissionMode,
	ReasoningEffort,
	ServiceTier,
	ThreadDetail,
	ThreadSummary,
	TimelineEntry,
	TimelineTurn
} from '$lib/types';

type JsonRpcResponse = {
	id: number;
	result?: unknown;
	error?: {
		code?: number;
		message?: string;
	};
};

type JsonRpcNotification = {
	method: string;
	params?: unknown;
	id?: number;
};

type ThreadStatus =
	| { type: 'notLoaded' | 'idle' | 'systemError' }
	| { type: 'active'; activeFlags: string[] };

type ThreadItem = Record<string, unknown> & {
	type: string;
	id: string;
};

type ThreadRecord = {
	id: string;
	name: string | null;
	preview: string;
	cwd: string;
	updatedAt: number;
	modelProvider?: string | null;
	status: ThreadStatus;
	turns: Array<{
		id: string;
		status: string;
		startedAt: number | null;
		completedAt: number | null;
		durationMs: number | null;
		items: ThreadItem[];
	}>;
};

type PendingApproval = ApprovalRequest & {
	rpcId: number;
	params: Record<string, unknown>;
};

type ReadThreadOptions = {
	tailTurns?: number | null;
};

type ApprovalPolicy = 'on-request' | 'on-failure' | 'never';
type SandboxName = 'workspace-write' | 'danger-full-access';
type ApprovalsReviewer = 'user' | 'auto_review';

const REQUEST_TIMEOUT_MS = 30_000;
const DIAGNOSTIC_PREVIEW_LIMIT = 800;
const EVENT_BACKLOG_LIMIT = 5_000;

export type SequencedConsoleEvent = {
	id: number;
	event: ConsoleEvent;
};

function stripTerminalControls(value: string): string {
	return value
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
		.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function diagnosticPreview(value: string): string {
	const sanitized = stripTerminalControls(value).trim();
	return sanitized.length > DIAGNOSTIC_PREVIEW_LIMIT
		? `${sanitized.slice(0, DIAGNOSTIC_PREVIEW_LIMIT)}...`
		: sanitized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readCommand(value: unknown): string | null {
	return readString(value) ??
		(Array.isArray(value)
			? value.filter((entry): entry is string => typeof entry === 'string').join(' ')
			: null);
}

function readJsonText(value: unknown): string | null {
	const text = readString(value);
	if (text !== null) return text;
	if (value === null || value === undefined) return null;

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return null;
	}
}

function readNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function normalizeThreadStatus(status: ThreadStatus): string {
	if (status.type === 'active') {
		return status.activeFlags.length > 0 ? status.activeFlags.join(', ') : 'active';
	}

	return status.type;
}

function normalizeTimestamp(value: number | null | undefined): number | null {
	if (!value || !Number.isFinite(value)) {
		return null;
	}

	return value < 10_000_000_000 ? value * 1000 : value;
}

function prettifyItemType(type: string): string {
	return type
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\w/, (char) => char.toUpperCase());
}

function normalizeToolCall(item: ThreadItem): TimelineEntry {
	const tool = asRecord(item.tool);
	const server = asRecord(item.server);
	const input =
		readJsonText(item.arguments) ??
		readJsonText(item.args) ??
		readJsonText(item.input) ??
		readJsonText(item.params);
	const output =
		readJsonText(item.result) ??
		readJsonText(item.output) ??
		readJsonText(item.error);
	const toolName =
		readString(item.toolName) ??
		readString(item.name) ??
		readString(item.functionName) ??
		readString(tool?.name) ??
		prettifyItemType(item.type);
	const serverName =
		readString(item.serverName) ??
		readString(item.mcpServerName) ??
		readString(server?.name) ??
		readString(item.server);

	return {
		id: item.id,
		kind: 'tool_call',
		label: 'Tool call',
		toolName,
		serverName: serverName ?? undefined,
		toolInput: input ?? undefined,
		toolOutput: output ?? undefined,
		status: readString(item.status),
		startedAt: normalizeTimestamp(readNumber(item.startedAt) ?? readNumber(item.started_at)),
		completedAt: normalizeTimestamp(readNumber(item.completedAt) ?? readNumber(item.completed_at)),
		durationMs: readNumber(item.durationMs) ?? readNumber(item.duration_ms)
	};
}

function readThreadId(params: Record<string, unknown>): string | null {
	return readString(params.threadId) ?? readString(asRecord(params.thread)?.id);
}

function readTurnId(params: Record<string, unknown>): string | null {
	return readString(params.turnId) ?? readString(asRecord(params.turn)?.id);
}

function readItemId(params: Record<string, unknown>): string | null {
	return readString(params.itemId) ?? readString(asRecord(params.item)?.id);
}

function normalizeCommandExecutionEvent(
	itemId: string,
	params: Record<string, unknown>,
	fallbackStatus: string
): TimelineEntry {
	const item = asRecord(params.item);
	if (item?.type === 'commandExecution') {
		const normalized = normalizeTimelineEntry({
			...item,
			id: readString(item.id) ?? itemId,
			type: 'commandExecution'
		});
		if (normalized.kind === 'command') {
			normalized.status ??= fallbackStatus;
			if (fallbackStatus === 'completed' || fallbackStatus === 'finished') {
				normalized.completedAt ??= Date.now();
			}
		}
		return normalized;
	}

	const output = readString(params.aggregatedOutput) ?? readString(params.output);
	const startedAt = normalizeTimestamp(readNumber(params.startedAt) ?? readNumber(params.started_at));
	const completedAt =
		normalizeTimestamp(readNumber(params.completedAt) ?? readNumber(params.completed_at)) ??
		(fallbackStatus === 'completed' || fallbackStatus === 'finished' ? Date.now() : null);
	const entry: TimelineEntry = {
		id: itemId,
		kind: 'command',
		label: 'Command',
		command: readCommand(params.command) ?? '',
		cwd: readString(params.cwd) ?? '',
		exitCode: readNumber(params.exitCode),
		status: readString(params.status) ?? fallbackStatus,
		startedAt: startedAt ?? (fallbackStatus === 'running' ? Date.now() : null),
		completedAt,
		durationMs: readNumber(params.durationMs) ?? readNumber(params.duration_ms)
	};

	if (output !== null) {
		entry.output = output;
	}

	return entry;
}

function normalizeThreadSummary(thread: ThreadRecord): ThreadSummary {
	return {
		id: thread.id,
		title: thread.name?.trim() || thread.preview.trim() || path.basename(thread.cwd) || thread.id,
		preview: thread.preview,
		cwd: thread.cwd,
		updatedAt: normalizeTimestamp(thread.updatedAt),
		status: normalizeThreadStatus(thread.status),
		provider: readString(thread.modelProvider)
	};
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
	return value === 'none' ||
		value === 'minimal' ||
		value === 'low' ||
		value === 'medium' ||
		value === 'high' ||
		value === 'xhigh'
		? value
		: null;
}

function normalizeServiceTier(value: unknown): ServiceTier | null {
	return value === 'fast' || value === 'flex' ? value : null;
}

function normalizeModelOption(value: unknown): ModelOption | null {
	const record = asRecord(value);
	if (!record) return null;

	const model = readString(record.model) ?? readString(record.id);
	if (!model) return null;

	const supportedReasoningEfforts = (
		Array.isArray(record.supportedReasoningEfforts) ? record.supportedReasoningEfforts : []
	)
		.map((entry) => normalizeReasoningEffort(asRecord(entry)?.reasoningEffort ?? asRecord(entry)?.effort ?? entry))
		.filter((entry): entry is ReasoningEffort => entry !== null);
	const defaultReasoningEffort =
		normalizeReasoningEffort(record.defaultReasoningEffort) ?? supportedReasoningEfforts[0] ?? 'medium';

	return {
		id: readString(record.id) ?? model,
		model,
		displayName: readString(record.displayName) ?? model,
		description: readString(record.description) ?? '',
		hidden: record.hidden === true,
		supportedReasoningEfforts,
		defaultReasoningEffort,
		additionalSpeedTiers: readStringArray(record.additionalSpeedTiers),
		isDefault: record.isDefault === true
	};
}

function modelRuntime(selection: ModelSelection | null | undefined): {
	model?: string;
	effort?: ReasoningEffort;
	serviceTier?: ServiceTier;
} {
	if (!selection) return {};

	const model = readString(selection.model);
	const effort = normalizeReasoningEffort(selection.effort);
	const serviceTier = normalizeServiceTier(selection.serviceTier);

	return {
		...(model ? { model } : {}),
		...(effort ? { effort } : {}),
		...(serviceTier ? { serviceTier } : {})
	};
}

function normalizeTimelineEntry(item: ThreadItem): TimelineEntry {
	switch (item.type) {
		case 'userMessage':
			return {
				id: item.id,
				kind: 'user',
				label: 'You',
				text: (Array.isArray(item.content) ? item.content : [])
					.map((part) => {
						const entry = asRecord(part);
						return entry && entry.type === 'text' && typeof entry.text === 'string' ? entry.text : '';
					})
					.filter((value): value is string => Boolean(value))
					.join('\n')
			};
		case 'agentMessage':
			return {
				id: item.id,
				kind: 'assistant',
				label: item.phase === 'commentary' ? 'Assistant commentary' : 'Assistant',
				text: readString(item.text) ?? '',
				phase: item.phase === 'commentary' || item.phase === 'final_answer' ? item.phase : null
			};
		case 'reasoning': {
			const reasoningText = [
				...(Array.isArray(item.summary)
					? item.summary.filter((value): value is string => typeof value === 'string')
					: []),
				...(Array.isArray(item.content)
					? item.content.filter((value): value is string => typeof value === 'string')
					: [])
			].join('\n');

			return {
				id: item.id,
				kind: 'reasoning',
				label: 'Reasoning',
				text: reasoningText
			};
		}
		case 'webSearch': {
			const action = asRecord(item.action);
			const queries = Array.isArray(action?.queries)
				? action.queries.filter((value): value is string => typeof value === 'string')
				: [];

			return {
				id: item.id,
				kind: 'web_search',
				label: 'Web search',
				query: readString(item.query) ?? '',
				actionType: readString(action?.type) ?? undefined,
				url: readString(action?.url) ?? undefined,
				pattern: readString(action?.pattern) ?? undefined,
				queries,
				text:
					readString(item.query) ??
					readString(action?.url) ??
					queries.join('\n')
			};
		}
		case 'mcpToolCall':
		case 'mcp_tool_call':
		case 'mcp-tool-call':
		case 'toolCall':
		case 'tool_call':
		case 'function_call':
		case 'functionCall':
			return normalizeToolCall(item);
		case 'commandExecution':
			return {
				id: item.id,
				kind: 'command',
				label: 'Command',
				command: readString(item.command) ?? '',
				cwd: readString(item.cwd) ?? '',
				output: readString(item.aggregatedOutput) ?? '',
				exitCode: readNumber(item.exitCode),
				status: readString(item.status),
				startedAt: normalizeTimestamp(readNumber(item.startedAt) ?? readNumber(item.started_at)),
				completedAt: normalizeTimestamp(readNumber(item.completedAt) ?? readNumber(item.completed_at)),
				durationMs: readNumber(item.durationMs) ?? readNumber(item.duration_ms)
			};
		case 'fileChange':
			return {
				id: item.id,
				kind: 'file_change',
				label: 'File change',
				status: readString(item.status),
				changes: (Array.isArray(item.changes) ? item.changes : [])
					.map((change) => {
						const entry = asRecord(change);
						if (!entry) {
							return null;
						}

						return {
							path: readString(entry.path) ?? '',
							kind: readString(entry.kind) ?? 'change',
							diff: readString(entry.diff) ?? ''
						};
					})
					.filter((change): change is { path: string; kind: string; diff: string } => change !== null)
			};
		case 'plan':
			return {
				id: item.id,
				kind: 'plan',
				label: 'Plan',
				text: readString(item.text) ?? ''
			};
		case 'contextCompaction':
			return {
				id: item.id,
				kind: 'system',
				label: 'Context compaction',
				text: 'Codex compacted the thread context.'
			};
		default:
			return {
				id: item.id,
				kind: 'system',
				label: prettifyItemType(item.type)
			};
	}
}

function normalizeThreadDetail(
	thread: ThreadRecord,
	approvals: ApprovalRequest[],
	options: ReadThreadOptions = {}
): ThreadDetail {
	const tailTurns =
		typeof options.tailTurns === 'number' && Number.isFinite(options.tailTurns) && options.tailTurns > 0
			? Math.floor(options.tailTurns)
			: null;
	const omittedTurnCount = tailTurns ? Math.max(0, thread.turns.length - tailTurns) : 0;
	const sourceTurns = omittedTurnCount > 0 ? thread.turns.slice(omittedTurnCount) : thread.turns;
	const turns: TimelineTurn[] = sourceTurns.map((turn) => ({
		id: turn.id,
		status: turn.status,
		startedAt: turn.startedAt,
		completedAt: turn.completedAt,
		durationMs: turn.durationMs,
		entries: turn.items.map(normalizeTimelineEntry)
	}));

	return {
		thread: normalizeThreadSummary(thread),
		turns,
		approvals,
		omittedTurnCount
	};
}

function buildWorkspaceWritePolicy(cwd: string) {
	return {
		type: 'workspaceWrite',
		writableRoots: [cwd, path.join(homedir(), '.codex', 'memories')],
		readOnlyAccess: {
			type: 'fullAccess'
		},
		networkAccess: false,
		excludeTmpdirEnvVar: false,
		excludeSlashTmp: false
	};
}

function normalizePermissionMode(mode: PermissionMode | null | undefined): PermissionMode {
	return mode === 'auto' || mode === 'full' ? mode : 'default';
}

function permissionRuntime(cwd: string, mode: PermissionMode | null | undefined): {
	approvalPolicy: ApprovalPolicy;
	approvalsReviewer: ApprovalsReviewer;
	sandbox: SandboxName;
	sandboxPolicy: Record<string, unknown>;
} {
	switch (normalizePermissionMode(mode)) {
		case 'auto':
			return {
				approvalPolicy: 'on-request',
				approvalsReviewer: 'auto_review',
				sandbox: 'workspace-write',
				sandboxPolicy: buildWorkspaceWritePolicy(cwd)
			};
		case 'full':
			return {
				approvalPolicy: 'never',
				approvalsReviewer: 'user',
				sandbox: 'danger-full-access',
				sandboxPolicy: { type: 'dangerFullAccess' }
			};
		default:
			return {
				approvalPolicy: 'on-request',
				approvalsReviewer: 'user',
				sandbox: 'workspace-write',
				sandboxPolicy: buildWorkspaceWritePolicy(cwd)
			};
	}
}

function approvalTitle(method: string): string {
	if (method === 'item/commandExecution/requestApproval') {
		return 'Command requires approval';
	}

	if (method === 'item/fileChange/requestApproval') {
		return 'File changes require approval';
	}

	if (method === 'item/permissions/requestApproval') {
		return 'Extra permissions require approval';
	}

	return 'Approval required';
}

function serializeApproval(
	rpcId: number,
	method: string,
	params: Record<string, unknown>
): PendingApproval | null {
	const threadId = readString(params.threadId);
	const turnId = readString(params.turnId);
	const itemId = readString(params.itemId);

	if (!threadId || !turnId || !itemId) {
		return null;
	}

	const command = readCommand(params.command);

	return {
		requestId: String(rpcId),
		rpcId,
		threadId,
		turnId,
		method,
		title: approvalTitle(method),
		reason: readString(params.reason),
		command,
		cwd: readString(params.cwd),
		grantRoot: readString(params.grantRoot),
		requestedAt: Date.now(),
		params
	};
}

class LocalCodexService {
	private process: ChildProcessWithoutNullStreams | null = null;
	private buffer = '';
	private requestId = 1;
	private startPromise: Promise<void> | null = null;
	private pendingRequests = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
			timeout: ReturnType<typeof setTimeout>;
		}
	>();
	private listeners = new Set<(event: ConsoleEvent, id: number) => void>();
	private eventBacklog: SequencedConsoleEvent[] = [];
	private eventSequence = 0;
	private pendingApprovals = new Map<string, PendingApproval>();

	subscribe(listener: (event: ConsoleEvent, id: number) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	getLatestEventId(): number {
		return this.eventSequence;
	}

	getEventsSince(id: number): SequencedConsoleEvent[] {
		return this.eventBacklog.filter((entry) => entry.id > id);
	}

	waitForEvents(id: number, timeoutMs: number, signal?: AbortSignal): Promise<SequencedConsoleEvent[]> {
		const pending = this.getEventsSince(id);
		if (pending.length > 0 || signal?.aborted) {
			return Promise.resolve(pending);
		}

		return new Promise((resolve) => {
			let done = false;
			let unsubscribe = () => {};
			let timeout: ReturnType<typeof setTimeout> | null = null;

			const finish = () => {
				if (done) return;
				done = true;
				unsubscribe();
				if (timeout !== null) clearTimeout(timeout);
				signal?.removeEventListener('abort', finish);
				resolve(this.getEventsSince(id));
			};

			unsubscribe = this.subscribe((_event, eventId) => {
				if (eventId > id) finish();
			});
			timeout = setTimeout(finish, timeoutMs);
			signal?.addEventListener('abort', finish, { once: true });
		});
	}

	getPendingApprovals(threadId: string): ApprovalRequest[] {
		return [...this.pendingApprovals.values()]
			.filter((approval) => approval.threadId === threadId)
			.map(({ rpcId: _rpcId, params: _params, ...approval }) => approval);
	}

	async listThreads(): Promise<ThreadSummary[]> {
		await this.ensureStarted();
		const response = (await this.request('thread/list', {
			limit: 50,
			archived: false,
			modelProviders: [],
			sortKey: 'updated_at',
			sortDirection: 'desc'
		})) as { data: ThreadRecord[] };

		return response.data.map(normalizeThreadSummary);
	}

	async listModels(): Promise<ModelOption[]> {
		await this.ensureStarted();
		const response = (await this.request('model/list', {
			limit: 100,
			includeHidden: false
		})) as { data: unknown[] };

		return (Array.isArray(response.data) ? response.data : [])
			.map(normalizeModelOption)
			.filter((model): model is ModelOption => model !== null);
	}

	async readThread(threadId: string, options: ReadThreadOptions = {}): Promise<ThreadDetail> {
		await this.ensureStarted();
		const response = (await this.request('thread/read', {
			threadId,
			includeTurns: true
		})) as { thread: ThreadRecord };

		return normalizeThreadDetail(response.thread, this.getPendingApprovals(threadId), options);
	}

	async createThread(
		cwd: string,
		prompt: string,
		permissionMode?: PermissionMode,
		modelSelection?: ModelSelection
	): Promise<ThreadSummary> {
		await this.ensureStarted();
		const permissions = permissionRuntime(cwd, permissionMode);
		const model = modelRuntime(modelSelection);

		const response = (await this.request('thread/start', {
			cwd,
			...(model.model ? { model: model.model } : {}),
			...(model.serviceTier ? { serviceTier: model.serviceTier } : {}),
			approvalPolicy: permissions.approvalPolicy,
			approvalsReviewer: permissions.approvalsReviewer,
			sandbox: permissions.sandbox,
			experimentalRawEvents: false,
			persistExtendedHistory: true
		})) as { thread: ThreadRecord };

		this.enqueueRequest('turn/start', {
			threadId: response.thread.id,
			input: [
				{
					type: 'text',
					text: prompt,
					text_elements: []
				}
			],
			approvalPolicy: permissions.approvalPolicy,
			approvalsReviewer: permissions.approvalsReviewer,
			sandboxPolicy: permissions.sandboxPolicy,
			...model
		}, 'Failed to start turn');

		return normalizeThreadSummary(response.thread);
	}

	async sendMessage(
		threadId: string,
		cwd: string,
		prompt: string,
		permissionMode?: PermissionMode,
		modelSelection?: ModelSelection
	): Promise<void> {
		await this.ensureStarted();
		const permissions = permissionRuntime(cwd, permissionMode);
		const model = modelRuntime(modelSelection);

		void this.request('thread/resume', {
			threadId,
			cwd,
			...(model.model ? { model: model.model } : {}),
			...(model.serviceTier ? { serviceTier: model.serviceTier } : {}),
			approvalPolicy: permissions.approvalPolicy,
			approvalsReviewer: permissions.approvalsReviewer,
			sandbox: permissions.sandbox,
			persistExtendedHistory: true
		})
			.then(() =>
				this.request('turn/start', {
					threadId,
					input: [
						{
							type: 'text',
							text: prompt,
							text_elements: []
						}
					],
					cwd,
					approvalPolicy: permissions.approvalPolicy,
					approvalsReviewer: permissions.approvalsReviewer,
					sandboxPolicy: permissions.sandboxPolicy,
					...model
				})
			)
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				this.emit({ type: 'error', message: `Failed to send message: ${message}` });
			});
	}

	async interruptTurn(threadId: string, turnId: string): Promise<void> {
		await this.ensureStarted();
		await this.request('turn/interrupt', {
			threadId,
			turnId
		});
	}

	async readDirectory(targetPath: string): Promise<DirectoryListing> {
		await this.ensureStarted();
		const response = (await this.request('fs/readDirectory', {
			path: targetPath
		})) as {
			entries: Array<{
				fileName: string;
				isDirectory: boolean;
				isFile: boolean;
			}>;
		};

		const parentPath = targetPath === path.dirname(targetPath) ? null : path.dirname(targetPath);

		return {
			path: targetPath,
			parentPath,
			entries: response.entries
				.map((entry) => ({
					name: entry.fileName,
					path: path.join(targetPath, entry.fileName),
					isDirectory: entry.isDirectory,
					isFile: entry.isFile
				}))
				.filter((entry) => entry.isDirectory)
				.sort((left, right) => left.name.localeCompare(right.name))
		};
	}

	async resolveApproval(
		requestId: string,
		decision: 'accept' | 'acceptForSession' | 'decline'
	): Promise<void> {
		await this.ensureStarted();
		const approval = this.pendingApprovals.get(requestId);

		if (!approval) {
			throw new Error('Approval request not found.');
		}

		if (
			approval.method === 'item/commandExecution/requestApproval' ||
			approval.method === 'item/fileChange/requestApproval'
		) {
			this.respond(approval.rpcId, { decision });
			return;
		}

		if (approval.method === 'item/permissions/requestApproval') {
			this.respond(approval.rpcId, {
				permissions: decision === 'decline' ? {} : approval.params.permissions ?? {},
				scope: decision === 'acceptForSession' ? 'session' : 'turn'
			});
			return;
		}

		throw new Error(`Unsupported approval method: ${approval.method}`);
	}

	private async ensureStarted(): Promise<void> {
		if (this.process) {
			return;
		}

		if (this.startPromise) {
			return this.startPromise;
		}

		this.startPromise = this.start();

		try {
			await this.startPromise;
		} finally {
			this.startPromise = null;
		}
	}

	private async start(): Promise<void> {
		this.process = spawn('codex', ['app-server', '--listen', 'stdio://'], {
			stdio: 'pipe',
			env: process.env,
			shell: process.platform === 'win32'
		});

		this.process.stdout.on('data', (chunk: Buffer) => {
			this.buffer += chunk.toString('utf8');
			const lines = this.buffer.split(/\r?\n/);
			this.buffer = lines.pop() ?? '';

			for (const line of lines) {
				this.handleLine(line);
			}
		});

		this.process.stderr.on('data', (chunk: Buffer) => {
			const message = diagnosticPreview(chunk.toString('utf8'));
			if (message) {
				console.warn(`[codex app-server] ${message}`);
			}
		});

		this.process.on('error', (error: Error) => {
			this.failProcess(error);
		});

		this.process.on('close', (code: number | null) => {
			const error = new Error(`Codex app-server exited with code ${code ?? -1}.`);
			this.failProcess(error);
		});

		await this.request('initialize', {
			clientInfo: {
				name: 'codex-web-console',
				version: '0.0.1'
			},
			capabilities: {
				experimentalApi: true
			}
		});

		this.notify('initialized');
	}

	private request(method: string, params?: unknown): Promise<unknown> {
		if (!this.process) {
			throw new Error('Codex app-server is not running.');
		}

		const id = this.requestId++;

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				const pending = this.pendingRequests.get(id);
				if (!pending) {
					return;
				}

				this.pendingRequests.delete(id);
				pending.reject(new Error(`Request timed out: ${method}`));
			}, REQUEST_TIMEOUT_MS);

			this.pendingRequests.set(id, { resolve, reject, timeout });
			this.write({ id, method, params });
		});
	}

	private enqueueRequest(method: string, params: unknown, failurePrefix: string): void {
		void this.request(method, params).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			this.emit({ type: 'error', message: `${failurePrefix}: ${message}` });
		});
	}

	private notify(method: string, params?: unknown): void {
		this.write({ method, params });
	}

	private respond(id: number, result: unknown): void {
		this.write({ id, result });
	}

	private respondError(id: number, code: number, message: string): void {
		this.write({ id, error: { code, message } });
	}

	private write(message: object): void {
		if (!this.process) {
			throw new Error('Codex app-server is not running.');
		}

		this.process.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private handleLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}

		let message: JsonRpcResponse | JsonRpcNotification;

		try {
			message = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcNotification;
		} catch {
			this.emit({ type: 'error', message: `Unexpected app-server output: ${diagnosticPreview(trimmed)}` });
			return;
		}

		if ('id' in message && typeof message.id === 'number' && !('method' in message)) {
			const pending = this.pendingRequests.get(message.id);
			if (!pending) {
				return;
			}

			this.pendingRequests.delete(message.id);
			clearTimeout(pending.timeout);

			if (message.error) {
				pending.reject(new Error(message.error.message || `Request ${message.id} failed.`));
				return;
			}

			pending.resolve(message.result);
			return;
		}

		if ('method' in message && typeof message.method === 'string') {
			if ('id' in message && typeof message.id === 'number') {
				this.handleServerRequest(message.method, message.id, asRecord(message.params));
				return;
			}

			this.handleNotification(message.method, asRecord(message.params));
		}
	}

	private handleServerRequest(
		method: string,
		id: number,
		params: Record<string, unknown> | null
	): void {
		const safeParams = params ?? {};

		if (
			method === 'item/commandExecution/requestApproval' ||
			method === 'item/fileChange/requestApproval' ||
			method === 'item/permissions/requestApproval'
		) {
			const approval = serializeApproval(id, method, safeParams);
			if (!approval) {
				this.respondError(id, -32602, 'Invalid approval payload');
				return;
			}

			this.pendingApprovals.set(approval.requestId, approval);
			this.emit({
				type: 'approval.requested',
				threadId: approval.threadId,
				approval: {
					requestId: approval.requestId,
					threadId: approval.threadId,
					turnId: approval.turnId,
					method: approval.method,
					title: approval.title,
					reason: approval.reason,
					command: approval.command,
					cwd: approval.cwd,
					grantRoot: approval.grantRoot,
					requestedAt: approval.requestedAt
				}
			});
			return;
		}

		this.respondError(id, -32601, `Unsupported server request: ${method}`);
	}

	private handleNotification(method: string, params: Record<string, unknown> | null): void {
		const safeParams = params ?? {};

		if (method === 'thread/started') {
			const thread = asRecord(safeParams.thread) as ThreadRecord | null;
			if (thread) {
				this.emit({ type: 'thread.started', thread: normalizeThreadSummary(thread) });
			}
			return;
		}

		if (method === 'turn/started' || method === 'turn/completed') {
			const threadId = readThreadId(safeParams);
			const turnId = readTurnId(safeParams);
			if (threadId && turnId) {
				this.emit({
					type: method === 'turn/started' ? 'turn.started' : 'turn.completed',
					threadId,
					turnId
				});
			}
			return;
		}

		if (method === 'item/agentMessage/delta') {
			const threadId = readThreadId(safeParams);
			const turnId = readTurnId(safeParams);
			const itemId = readItemId(safeParams);
			const delta = typeof safeParams.delta === 'string' ? safeParams.delta : '';
			if (threadId && turnId && itemId && delta) {
				this.emit({ type: 'message.delta', threadId, turnId, itemId, delta });
			}
			return;
		}

		if (method === 'item/reasoning/summaryTextDelta') {
			const threadId = readThreadId(safeParams);
			const turnId = readTurnId(safeParams);
			const itemId = readItemId(safeParams);
			const delta = typeof safeParams.delta === 'string' ? safeParams.delta : '';
			if (threadId && turnId && itemId && delta) {
				this.emit({ type: 'reasoning.delta', threadId, turnId, itemId, delta });
			}
			return;
		}

		if (method === 'item/commandExecution/outputDelta') {
			const threadId = readThreadId(safeParams);
			const turnId = readTurnId(safeParams);
			const itemId = readItemId(safeParams);
			const delta = typeof safeParams.delta === 'string' ? safeParams.delta : '';
			if (threadId && turnId && itemId && delta) {
				this.emit({
					type: 'command.delta',
					threadId,
					turnId,
					itemId,
					delta,
					item: normalizeCommandExecutionEvent(itemId, safeParams, 'running')
				});
			}
			return;
		}

		if (
			method === 'item/commandExecution/started' ||
			method === 'item/commandExecution/completed' ||
			method === 'item/commandExecution/finished'
		) {
			const threadId = readThreadId(safeParams);
			const turnId = readTurnId(safeParams);
			const itemId = readItemId(safeParams);

			if (threadId && turnId && itemId) {
				const completed =
					method === 'item/commandExecution/completed' ||
					method === 'item/commandExecution/finished';
				this.emit({
					type: completed ? 'item.completed' : 'item.started',
					threadId,
					turnId,
					item: normalizeCommandExecutionEvent(itemId, safeParams, completed ? 'completed' : 'running')
				});
			}
			return;
		}

		if (method === 'item/fileChange/outputDelta') {
			const threadId = readThreadId(safeParams);
			const turnId = readTurnId(safeParams);
			const itemId = readItemId(safeParams);
			const delta = typeof safeParams.delta === 'string' ? safeParams.delta : '';
			if (threadId && turnId && itemId && delta) {
				this.emit({ type: 'file_change.delta', threadId, turnId, itemId, delta });
			}
			return;
		}

		if (method === 'item/started' || method === 'item/completed') {
			const threadId = readThreadId(safeParams);
			const turnId = readTurnId(safeParams);
			const item = asRecord(safeParams.item) as ThreadItem | null;

			if (threadId && turnId && item) {
				const normalized = normalizeTimelineEntry(item);
				if (method === 'item/completed' && (normalized.kind === 'command' || normalized.kind === 'tool_call')) {
					normalized.status ??= 'completed';
					normalized.completedAt ??= Date.now();
				}
				this.emit({
					type: method === 'item/started' ? 'item.started' : 'item.completed',
					threadId,
					turnId,
					item: normalized
				});
			}
			return;
		}

		if (method === 'serverRequest/resolved') {
			const threadId = readString(safeParams.threadId);
			const requestId = safeParams.requestId;
			if (threadId && (typeof requestId === 'number' || typeof requestId === 'string')) {
				this.pendingApprovals.delete(String(requestId));
				this.emit({
					type: 'approval.resolved',
					threadId,
					requestId: String(requestId)
				});
			}
			return;
		}

		if (method === 'error') {
			const message = readString(asRecord(safeParams.error)?.message);
			if (message) {
				this.emit({ type: 'error', message });
			}
		}
	}

	private emit(event: ConsoleEvent): void {
		const id = ++this.eventSequence;
		this.eventBacklog.push({ id, event });
		if (this.eventBacklog.length > EVENT_BACKLOG_LIMIT) {
			this.eventBacklog.splice(0, this.eventBacklog.length - EVENT_BACKLOG_LIMIT);
		}

		for (const listener of this.listeners) {
			listener(event, id);
		}
	}

	private failProcess(error: Error): void {
		for (const request of this.pendingRequests.values()) {
			clearTimeout(request.timeout);
			request.reject(error);
		}

		this.pendingRequests.clear();
		this.pendingApprovals.clear();
		this.process = null;
		this.buffer = '';

		this.emit({ type: 'error', message: error.message });
	}
}

export const codex = new LocalCodexService();
