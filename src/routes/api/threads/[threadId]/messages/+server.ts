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
		cwd?: string;
		prompt?: string;
	};

	const cwd = String(body.cwd ?? '').trim();
	const prompt = String(body.prompt ?? '').trim();

	if (!cwd || !prompt) {
		return json({ error: 'Workspace path and prompt are required.' }, { status: 400 });
	}

	await codex.sendMessage(params.threadId, cwd, prompt);
	return json({ ok: true });
};
