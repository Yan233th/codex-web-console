import { error, json } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';
import type { PermissionMode } from '$lib/types';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

function parsePermissionMode(value: unknown): PermissionMode {
	return value === 'auto' || value === 'full' ? value : 'default';
}

export const POST = async ({ locals, params, request }) => {
	requireAuth(locals);

	let body: {
		cwd?: string;
		prompt?: string;
		permissionMode?: unknown;
	};

	try {
		body = (await request.json()) as {
			cwd?: string;
			prompt?: string;
			permissionMode?: unknown;
		};
	} catch {
		return json({ error: 'Request body must be valid JSON.' }, { status: 400 });
	}

	const cwd = String(body.cwd ?? '').trim();
	const prompt = String(body.prompt ?? '').trim();
	const permissionMode = parsePermissionMode(body.permissionMode);

	if (!cwd || !prompt) {
		return json({ error: 'Workspace path and prompt are required.' }, { status: 400 });
	}

	try {
		await codex.sendMessage(params.threadId, cwd, prompt, permissionMode);
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};
