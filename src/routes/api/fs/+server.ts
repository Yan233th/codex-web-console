import path from 'node:path';
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

	const rawPath = url.searchParams.get('path')?.trim() || homedir();

	// Security: normalize and validate to prevent path traversal
	const resolved = path.resolve(path.normalize(rawPath));
	const home = path.resolve(homedir());

	// Only allow paths under the home directory
	if (!resolved.startsWith(home + path.sep) && resolved !== home) {
		return json({ error: 'Access denied' }, { status: 403 });
	}

	try {
		return json({ listing: await codex.readDirectory(resolved) });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};
