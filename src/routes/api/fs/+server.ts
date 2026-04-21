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
	return json({ listing: await codex.readDirectory(targetPath) });
};
