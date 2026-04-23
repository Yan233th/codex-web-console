import { error, json } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

export const GET = async ({ locals }) => {
	requireAuth(locals);

	try {
		return json({ threads: await codex.listThreads() });
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
	};

	try {
		body = (await request.json()) as {
			cwd?: string;
			prompt?: string;
		};
	} catch {
		return json({ error: 'Request body must be valid JSON.' }, { status: 400 });
	}

	const cwd = String(body.cwd ?? '').trim();
	const prompt = String(body.prompt ?? '').trim();

	if (!cwd || !prompt) {
		return json({ error: 'Workspace path and prompt are required.' }, { status: 400 });
	}

	try {
		return json({
			thread: await codex.createThread(cwd, prompt)
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};
