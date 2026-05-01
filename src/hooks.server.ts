import type { Handle } from '@sveltejs/kit';

import { readAuthState } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const auth = readAuthState(event.cookies);
	event.locals.authenticated = auth.authenticated;
	event.locals.tokenConfigured = auth.tokenConfigured;
	event.locals.fallbackTokenActive = auth.fallbackActive;

	const response = await resolve(event);

	const csp = [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: http: https:",
		"font-src 'self'",
		"connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
		"frame-ancestors 'none'",
		"form-action 'self'"
	].join('; ');

	try { response.headers.set('content-security-policy', csp); } catch {}

	return response;
};
