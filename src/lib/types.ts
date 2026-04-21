export type EntryKind =
	| 'user'
	| 'assistant'
	| 'reasoning'
	| 'web_search'
	| 'command'
	| 'file_change'
	| 'plan'
	| 'system';

export interface ThreadSummary {
	id: string;
	title: string;
	preview: string;
	cwd: string;
	updatedAt: number;
	status: string;
	provider: string | null;
}

export interface TimelineEntry {
	id: string;
	kind: EntryKind;
	label: string;
	text?: string;
	phase?: 'commentary' | 'final_answer' | null;
	command?: string;
	cwd?: string;
	output?: string;
	query?: string;
	url?: string;
	pattern?: string;
	actionType?: string | null;
	queries?: string[];
	exitCode?: number | null;
	status?: string | null;
	durationMs?: number | null;
	changes?: Array<{
		path: string;
		kind: string;
		diff: string;
	}>;
}

export interface TimelineTurn {
	id: string;
	status: string;
	startedAt: number | null;
	completedAt: number | null;
	durationMs: number | null;
	entries: TimelineEntry[];
}

export interface ApprovalRequest {
	requestId: string;
	threadId: string;
	turnId: string;
	method: string;
	title: string;
	reason: string | null;
	command: string | null;
	cwd: string | null;
	grantRoot: string | null;
}

export interface ThreadDetail {
	thread: ThreadSummary;
	turns: TimelineTurn[];
	approvals: ApprovalRequest[];
}

export interface DirectoryListing {
	path: string;
	parentPath: string | null;
	entries: Array<{
		name: string;
		path: string;
		isDirectory: boolean;
		isFile: boolean;
	}>;
}

export type ConsoleEvent =
	| {
			type: 'thread.started';
			thread: ThreadSummary;
	  }
	| {
			type: 'turn.started' | 'turn.completed';
			threadId: string;
			turnId: string;
	  }
	| {
			type: 'item.started' | 'item.completed';
			threadId: string;
			turnId: string;
			item: TimelineEntry;
	  }
	| {
			type: 'message.delta' | 'reasoning.delta' | 'command.delta' | 'file_change.delta';
			threadId: string;
			turnId: string;
			itemId: string;
			delta: string;
	  }
	| {
			type: 'approval.requested';
			threadId: string;
			approval: ApprovalRequest;
	  }
	| {
			type: 'approval.resolved';
			threadId: string;
			requestId: string;
	  }
	| {
			type: 'error';
			message: string;
	  };
