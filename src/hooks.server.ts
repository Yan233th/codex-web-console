import type { Handle } from '@sveltejs/kit';

import { readAuthState } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const auth = readAuthState(event.cookies);
	event.locals.authenticated = auth.authenticated;
	event.locals.tokenConfigured = auth.tokenConfigured;
	event.locals.fallbackTokenActive = auth.fallbackActive;
	return resolve(event);
};
