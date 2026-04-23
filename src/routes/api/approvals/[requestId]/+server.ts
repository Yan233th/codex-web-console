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
		decision?: 'accept' | 'acceptForSession' | 'decline';
	};

	try {
		body = (await request.json()) as {
			decision?: 'accept' | 'acceptForSession' | 'decline';
		};
	} catch {
		return json({ error: 'Request body must be valid JSON.' }, { status: 400 });
	}

	if (
		body.decision !== 'accept' &&
		body.decision !== 'acceptForSession' &&
		body.decision !== 'decline'
	) {
		return json({ error: 'A valid approval decision is required.' }, { status: 400 });
	}

	try {
		await codex.resolveApproval(params.requestId, body.decision);
		return json({ ok: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};
