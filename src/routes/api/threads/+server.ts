import { error, json } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

export const GET = async ({ locals }) => {
	requireAuth(locals);
	return json({ threads: await codex.listThreads() });
};

export const POST = async ({ locals, request }) => {
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

	return json({
		thread: await codex.createThread(cwd, prompt)
	});
};
