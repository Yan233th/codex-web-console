import { error, json } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

export const POST = async ({ locals, params, request }) => {
	requireAuth(locals);

	const body = (await request.json()) as {
		turnId?: string;
	};

	const turnId = String(body.turnId ?? '').trim();
	if (!turnId) {
		return json({ error: 'Turn id is required.' }, { status: 400 });
	}

	await codex.interruptTurn(params.threadId, turnId);
	return json({ ok: true });
};
