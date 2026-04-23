import { error, json } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

export const POST = async ({ locals, params, request }) => {
	requireAuth(locals);

	let body: {
		turnId?: string;
	};

	try {
		body = (await request.json()) as {
			turnId?: string;
		};
	} catch {
		return json({ error: 'Request body must be valid JSON.' }, { status: 400 });
	}

	const turnId = String(body.turnId ?? '').trim();
	if (!turnId) {
		return json({ error: 'Turn id is required.' }, { status: 400 });
	}

	try {
		await codex.interruptTurn(params.threadId, turnId);
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};
