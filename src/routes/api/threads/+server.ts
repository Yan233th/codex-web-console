import { error, json } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';
import type {
	ModelSelection,
	PermissionMode,
	ReasoningEffort,
	ServiceTier,
	ThreadSummary
} from '$lib/types';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

function parsePermissionMode(value: unknown): PermissionMode {
	return value === 'auto' || value === 'full' ? value : 'default';
}

function parseReasoningEffort(value: unknown): ReasoningEffort | null {
	return value === 'none' ||
		value === 'minimal' ||
		value === 'low' ||
		value === 'medium' ||
		value === 'high' ||
		value === 'xhigh'
		? value
		: null;
}

function parseServiceTier(value: unknown): ServiceTier | null {
	return value === 'fast' || value === 'flex' ? value : null;
}

function parseModelSelection(value: unknown): ModelSelection | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const record = value as Record<string, unknown>;
	const model = typeof record.model === 'string' ? record.model.trim() : '';
	const effort = parseReasoningEffort(record.effort);
	const serviceTier = parseServiceTier(record.serviceTier);

	return {
		...(model ? { model } : {}),
		...(effort ? { effort } : {}),
		...(serviceTier ? { serviceTier } : {})
	};
}

function buildThreadListSignature(threads: ThreadSummary[]): string {
	return threads
		.map((thread) =>
			[
				thread.id,
				thread.updatedAt ?? '',
				thread.status,
				thread.title,
				thread.preview,
				thread.cwd,
				thread.provider ?? ''
			].join('\u001f')
		)
		.join('\u001e');
}

export const GET = async ({ locals, url }) => {
	requireAuth(locals);

	try {
		const threads = await codex.listThreads();
		const signature = buildThreadListSignature(threads);
		if (url.searchParams.get('view') === 'probe') {
			return json({
				signature,
				count: threads.length,
				latestUpdatedAt: threads[0]?.updatedAt ?? null
			});
		}
		return json({ threads, signature });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};

export const POST = async ({ locals, request }) => {
	requireAuth(locals);

	let body: {
		cwd?: string;
		prompt?: string;
		permissionMode?: unknown;
		modelSelection?: unknown;
		images?: unknown;
	};

	try {
		body = (await request.json()) as {
			cwd?: string;
			prompt?: string;
			permissionMode?: unknown;
			modelSelection?: unknown;
			images?: unknown;
		};
	} catch {
		return json({ error: 'Request body must be valid JSON.' }, { status: 400 });
	}

	const cwd = String(body.cwd ?? '').trim();
	const prompt = String(body.prompt ?? '').trim();
	const permissionMode = parsePermissionMode(body.permissionMode);
	const modelSelection = parseModelSelection(body.modelSelection);
	const images = Array.isArray(body.images)
		? body.images.filter((img): img is string => typeof img === 'string' && img.length > 0)
		: undefined;

	if (!cwd || !prompt) {
		return json({ error: 'Workspace path and prompt are required.' }, { status: 400 });
	}

	try {
		return json({
			thread: await codex.createThread(cwd, prompt, permissionMode, modelSelection, images)
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};
