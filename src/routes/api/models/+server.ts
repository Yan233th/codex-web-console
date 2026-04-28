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
		return json({ models: await codex.listModels() });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};
