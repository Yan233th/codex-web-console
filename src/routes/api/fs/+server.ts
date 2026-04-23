import { homedir } from 'node:os';

import { error, json } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

export const GET = async ({ locals, url }) => {
	requireAuth(locals);
	const targetPath = url.searchParams.get('path')?.trim() || homedir();

	try {
		return json({ listing: await codex.readDirectory(targetPath) });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};
