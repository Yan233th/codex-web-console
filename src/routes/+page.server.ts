import { homedir } from 'node:os';

import { fail, redirect } from '@sveltejs/kit';

import { clearAuthCookie, saveTokenToConfig, verifySubmittedToken, writeAuthCookie } from '$lib/server/auth';
import { codex } from '$lib/server/codex';

export const load = async ({ locals, url }) => {
	if (!locals.authenticated) {
		return {
			authenticated: false,
			tokenConfigured: locals.tokenConfigured,
			setupMode: !locals.tokenConfigured,
			fallbackTokenActive: locals.fallbackTokenActive,
			threads: [],
			selectedThread: null,
			homePath: homedir(),
			codexError: null
		};
	}

	try {
		const requestedThreadId = url.searchParams.get('thread')?.trim() || null;
		const threads = await codex.listThreads();
		let selectedThread = null;
		let codexError: string | null = null;

		if (requestedThreadId) {
			try {
				selectedThread = await codex.readThread(requestedThreadId, { tailTurns: 5 });
			} catch (error) {
				codexError = error instanceof Error ? error.message : String(error);
			}
		}

		return {
			authenticated: true,
			tokenConfigured: true,
			setupMode: false,
			fallbackTokenActive: locals.fallbackTokenActive,
			threads,
			selectedThread,
			homePath: homedir(),
			codexError
		};
	} catch (error) {
		return {
			authenticated: true,
			tokenConfigured: true,
			setupMode: false,
			fallbackTokenActive: locals.fallbackTokenActive,
			threads: [],
			selectedThread: null,
			homePath: homedir(),
			codexError: error instanceof Error ? error.message : String(error)
		};
	}
};

export const actions = {
	setup: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const token = String(form.get('token') ?? '').trim();

		if (!token) {
			return fail(400, { setupError: 'Token is required.' });
		}

		if (token.length < 4) {
			return fail(400, { setupError: 'Token must be at least 4 characters.' });
		}

		saveTokenToConfig(token);

		// Verify immediately and log in
		if (verifySubmittedToken(token)) {
			writeAuthCookie(cookies, url.protocol === 'https:');
		}

		throw redirect(303, '/');
	},
	login: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const token = String(form.get('token') ?? '').trim();

		if (!token) {
			return fail(400, { loginError: 'Token is required.' });
		}

		if (!verifySubmittedToken(token)) {
			return fail(400, { loginError: 'Token is invalid.' });
		}

		writeAuthCookie(cookies, url.protocol === 'https:');
		throw redirect(303, '/');
	},
	logout: async ({ cookies }) => {
		clearAuthCookie(cookies);
		throw redirect(303, '/');
	}
};
