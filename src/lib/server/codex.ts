import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

import type {
	ApprovalRequest,
	ConsoleEvent,
	DirectoryListing,
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

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeThreadStatus(status: ThreadStatus): string {
	if (status.type === 'active') {
		return status.activeFlags.length > 0 ? status.activeFlags.join(', ') : 'active';
	}

	return status.type;
}

function normalizeTimestamp(value: number | null | undefined): number {
	if (!value || !Number.isFinite(value)) {
		return Date.now();
	}

	return value < 10_000_000_000 ? value * 1000 : value;
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
		case 'commandExecution':
			return {
				id: item.id,
				kind: 'command',
				label: 'Command',
				command: readString(item.command) ?? '',
				cwd: readString(item.cwd) ?? '',
				output: readString(item.aggregatedOutput) ?? '',
				exitCode: typeof item.exitCode === 'number' ? item.exitCode : null,
				status: readString(item.status),
				durationMs: typeof item.durationMs === 'number' ? item.durationMs : null
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
				label: item.type
			};
	}
}

function normalizeThreadDetail(thread: ThreadRecord, approvals: ApprovalRequest[]): ThreadDetail {
	const turns: TimelineTurn[] = thread.turns.map((turn) => ({
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
		approvals
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

	const command =
		readString(params.command) ||
		(Array.isArray(params.command)
			? params.command.filter((value): value is string => typeof value === 'string').join(' ')
			: null);

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
		}
	>();
	private listeners = new Set<(event: ConsoleEvent) => void>();
	private pendingApprovals = new Map<string, PendingApproval>();

	subscribe(listener: (event: ConsoleEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
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

	async readThread(threadId: string): Promise<ThreadDetail> {
		await this.ensureStarted();
		const response = (await this.request('thread/read', {
			threadId,
			includeTurns: true
		})) as { thread: ThreadRecord };

		return normalizeThreadDetail(response.thread, this.getPendingApprovals(threadId));
	}

	async createThread(cwd: string, prompt: string): Promise<ThreadSummary> {
		await this.ensureStarted();

		const response = (await this.request('thread/start', {
			cwd,
			approvalPolicy: 'on-request',
			sandbox: 'workspace-write',
			experimentalRawEvents: false,
			persistExtendedHistory: true
		})) as { thread: ThreadRecord };

		await this.request('turn/start', {
			threadId: response.thread.id,
			input: [
				{
					type: 'text',
					text: prompt,
					text_elements: []
				}
			],
			approvalPolicy: 'on-request',
			sandboxPolicy: buildWorkspaceWritePolicy(cwd)
		});

		return normalizeThreadSummary(response.thread);
	}

	async sendMessage(threadId: string, cwd: string, prompt: string): Promise<void> {
		await this.ensureStarted();
		await this.request('thread/resume', {
			threadId,
			cwd,
			approvalPolicy: 'on-request',
			sandbox: 'workspace-write',
			persistExtendedHistory: true
		});

		await this.request('turn/start', {
			threadId,
			input: [
				{
					type: 'text',
					text: prompt,
					text_elements: []
				}
			],
			cwd,
			approvalPolicy: 'on-request',
			sandboxPolicy: buildWorkspaceWritePolicy(cwd)
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
			env: process.env
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
			const message = chunk.toString('utf8').trim();
			if (message) {
				this.emit({ type: 'error', message });
			}
		});

		this.process.on('close', (code: number | null) => {
			const error = new Error(`Codex app-server exited with code ${code ?? -1}.`);
			for (const request of this.pendingRequests.values()) {
				request.reject(error);
			}

			this.pendingRequests.clear();
			this.pendingApprovals.clear();
			this.process = null;
			this.buffer = '';

			this.emit({ type: 'error', message: error.message });
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
			this.pendingRequests.set(id, { resolve, reject });
			this.write({ id, method, params });
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
			this.emit({ type: 'error', message: trimmed });
			return;
		}

		if ('id' in message && typeof message.id === 'number' && !('method' in message)) {
			const pending = this.pendingRequests.get(message.id);
			if (!pending) {
				return;
			}

			this.pendingRequests.delete(message.id);

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
					grantRoot: approval.grantRoot
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
			const threadId = readString(safeParams.threadId);
			const turnId = readString(asRecord(safeParams.turn)?.id);
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
			const threadId = readString(safeParams.threadId);
			const turnId = readString(safeParams.turnId);
			const itemId = readString(safeParams.itemId);
			const delta = typeof safeParams.delta === 'string' ? safeParams.delta : '';
			if (threadId && turnId && itemId && delta) {
				this.emit({ type: 'message.delta', threadId, turnId, itemId, delta });
			}
			return;
		}

		if (method === 'item/reasoning/summaryTextDelta') {
			const threadId = readString(safeParams.threadId);
			const turnId = readString(safeParams.turnId);
			const itemId = readString(safeParams.itemId);
			const delta = typeof safeParams.delta === 'string' ? safeParams.delta : '';
			if (threadId && turnId && itemId && delta) {
				this.emit({ type: 'reasoning.delta', threadId, turnId, itemId, delta });
			}
			return;
		}

		if (method === 'item/commandExecution/outputDelta') {
			const threadId = readString(safeParams.threadId);
			const turnId = readString(safeParams.turnId);
			const itemId = readString(safeParams.itemId);
			const delta = typeof safeParams.delta === 'string' ? safeParams.delta : '';
			if (threadId && turnId && itemId && delta) {
				this.emit({ type: 'command.delta', threadId, turnId, itemId, delta });
			}
			return;
		}

		if (method === 'item/fileChange/outputDelta') {
			const threadId = readString(safeParams.threadId);
			const turnId = readString(safeParams.turnId);
			const itemId = readString(safeParams.itemId);
			const delta = typeof safeParams.delta === 'string' ? safeParams.delta : '';
			if (threadId && turnId && itemId && delta) {
				this.emit({ type: 'file_change.delta', threadId, turnId, itemId, delta });
			}
			return;
		}

		if (method === 'item/started' || method === 'item/completed') {
			const threadId = readString(safeParams.threadId);
			const turnId = readString(safeParams.turnId);
			const item = asRecord(safeParams.item) as ThreadItem | null;

			if (threadId && turnId && item) {
				this.emit({
					type: method === 'item/started' ? 'item.started' : 'item.completed',
					threadId,
					turnId,
					item: normalizeTimelineEntry(item)
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
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

export const codex = new LocalCodexService();
