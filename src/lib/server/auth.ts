import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';

const AUTH_COOKIE = 'cwc_auth';
const DEV_FALLBACK_TOKEN = 'codex-web-console';

function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function readAccessToken(): string | null {
	const token = env.CODEX_WEB_CONSOLE_TOKEN?.trim();
	return token ? token : null;
}

export function getConfiguredToken(): {
	token: string | null;
	fallbackActive: boolean;
} {
	const envToken = readAccessToken();
	if (envToken) {
		return { token: envToken, fallbackActive: false };
	}

	if (dev) {
		return { token: DEV_FALLBACK_TOKEN, fallbackActive: true };
	}

	return { token: null, fallbackActive: false };
}

export function readAuthState(cookies: Cookies): {
	authenticated: boolean;
	tokenConfigured: boolean;
	fallbackActive: boolean;
} {
	const configured = getConfiguredToken();
	const cookie = cookies.get(AUTH_COOKIE);

	if (!configured.token || !cookie) {
		return {
			authenticated: false,
			tokenConfigured: configured.token !== null,
			fallbackActive: configured.fallbackActive
		};
	}

	const expected = Buffer.from(digest(configured.token));
	const actual = Buffer.from(cookie);

	return {
		authenticated:
			expected.length === actual.length && timingSafeEqual(expected, actual),
		tokenConfigured: true,
		fallbackActive: configured.fallbackActive
	};
}

export function verifySubmittedToken(token: string): boolean {
	const configured = getConfiguredToken();
	if (!configured.token) {
		return false;
	}

	const expected = Buffer.from(digest(configured.token));
	const actual = Buffer.from(digest(token.trim()));

	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function writeAuthCookie(cookies: Cookies, secure: boolean): void {
	const configured = getConfiguredToken();
	if (!configured.token) {
		return;
	}

	cookies.set(AUTH_COOKIE, digest(configured.token), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: 60 * 60 * 24 * 30
	});
}

export function clearAuthCookie(cookies: Cookies): void {
	cookies.delete(AUTH_COOKIE, { path: '/' });
}
