import { error, json } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

function parseTailTurns(value: string | null): number | null {
	if (!value) return null;
	const count = Number(value);
	if (!Number.isFinite(count) || count <= 0) return null;
	return Math.min(50, Math.floor(count));
}

export const GET = async ({ locals, params, url }) => {
	requireAuth(locals);

	try {
		return json({ detail: await codex.readThread(params.threadId, { tailTurns: parseTailTurns(url.searchParams.get('tailTurns')) }) });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};

export const PATCH = async ({ locals, params, request }) => {
	requireAuth(locals);

	let body: { name?: unknown };

	try {
		body = (await request.json()) as { name?: unknown };
	} catch {
		return json({ error: 'Request body must be valid JSON.' }, { status: 400 });
	}

	const name = typeof body.name === 'string' ? body.name.trim() : '';

	if (!name) {
		return json({ error: 'Thread name is required.' }, { status: 400 });
	}

	try {
		return json({ thread: await codex.renameThread(params.threadId, name) });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};

export const DELETE = async ({ locals, params }) => {
	requireAuth(locals);

	try {
		await codex.archiveThread(params.threadId);
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};
