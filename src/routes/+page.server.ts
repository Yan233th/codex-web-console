import { homedir } from 'node:os';

import { fail, redirect } from '@sveltejs/kit';

import { clearAuthCookie, verifySubmittedToken, writeAuthCookie } from '$lib/server/auth';
import { codex } from '$lib/server/codex';

export const load = async ({ locals }) => {
	if (!locals.authenticated) {
		return {
			authenticated: false,
			tokenConfigured: locals.tokenConfigured,
			fallbackTokenActive: locals.fallbackTokenActive,
			threads: [],
			selectedThread: null,
			homePath: homedir(),
			codexError: null
		};
	}

	try {
		const threads = await codex.listThreads();
		const selectedThread = threads[0] ? await codex.readThread(threads[0].id) : null;

		return {
			authenticated: true,
			tokenConfigured: true,
			fallbackTokenActive: locals.fallbackTokenActive,
			threads,
			selectedThread,
			homePath: homedir(),
			codexError: null
		};
	} catch (error) {
		return {
			authenticated: true,
			tokenConfigured: true,
			fallbackTokenActive: locals.fallbackTokenActive,
			threads: [],
			selectedThread: null,
			homePath: homedir(),
			codexError: error instanceof Error ? error.message : String(error)
		};
	}
};

export const actions = {
	login: async ({ request, cookies }) => {
		const form = await request.formData();
		const token = String(form.get('token') ?? '').trim();

		if (!token) {
			return fail(400, { loginError: 'Token is required.' });
		}

		if (!verifySubmittedToken(token)) {
			return fail(400, { loginError: 'Token is invalid.' });
		}

		writeAuthCookie(cookies);
		throw redirect(303, '/');
	},
	logout: async ({ cookies }) => {
		clearAuthCookie(cookies);
		throw redirect(303, '/');
	}
};
