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
		decision?: 'accept' | 'acceptForSession' | 'decline';
	};

	if (
		body.decision !== 'accept' &&
		body.decision !== 'acceptForSession' &&
		body.decision !== 'decline'
	) {
		return json({ error: 'A valid approval decision is required.' }, { status: 400 });
	}

	await codex.resolveApproval(params.requestId, body.decision);
	return json({ ok: true });
};
