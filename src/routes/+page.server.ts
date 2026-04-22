import { homedir } from 'node:os';

import { fail, redirect } from '@sveltejs/kit';

import { clearAuthCookie, verifySubmittedToken, writeAuthCookie } from '$lib/server/auth';
import { codex } from '$lib/server/codex';

export const load = async ({ locals, url }) => {
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
		const requestedThreadId = url.searchParams.get('thread')?.trim() || null;
		const threads = await codex.listThreads();
		let selectedThread = null;
		let codexError: string | null = null;

		if (requestedThreadId) {
			try {
				selectedThread = await codex.readThread(requestedThreadId);
			} catch (error) {
				codexError = error instanceof Error ? error.message : String(error);
			}
		}

		return {
			authenticated: true,
			tokenConfigured: true,
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
