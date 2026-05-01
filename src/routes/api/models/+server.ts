import { error, json } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';
import type { ModelOption, ReasoningEffort } from '$lib/types';

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

/** Normalize an OpenAI-compatible /models response entry into a ModelOption. */
function normalizeOaiModel(raw: Record<string, unknown>, provider: string): ModelOption | null {
	const id = typeof raw.id === 'string' ? raw.id : null;
	if (!id) return null;
	return {
		id,
		model: id,
		displayName: typeof raw.display_name === 'string' ? raw.display_name : id,
		description: typeof raw.description === 'string' ? raw.description : `${provider} model`,
		hidden: false,
		supportedReasoningEfforts: [] as ReasoningEffort[],
		defaultReasoningEffort: 'medium' as ReasoningEffort,
		additionalSpeedTiers: [],
		isDefault: false,
		provider
	};
}

/** POST /api/models  { url: "http://host:port" }
 *  Fetches models from a custom provider's /models endpoint and normalises them. */
export const POST = async ({ locals, request }) => {
	requireAuth(locals);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const url = typeof (body as Record<string, unknown>)?.url === 'string'
		? (body as Record<string, unknown>).url as string
		: null;
	if (!url) return json({ error: 'Missing "url" field' }, { status: 400 });

	// Derive a short provider label from the URL hostname
	let provider: string;
	try {
		provider = new URL(url).hostname;
	} catch {
		return json({ error: 'Invalid URL' }, { status: 400 });
	}

	const modelsUrl = url.replace(/\/+$/, '') + '/models';

	try {
		const resp = await fetch(modelsUrl, { signal: AbortSignal.timeout(8000) });
		if (!resp.ok) {
			return json({ error: `Upstream returned ${resp.status}` }, { status: 502 });
		}
		const data = await resp.json() as Record<string, unknown>;
		const rawList: unknown[] = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
		const models = rawList
			.map((entry) => normalizeOaiModel(entry as Record<string, unknown>, provider))
			.filter((m): m is ModelOption => m !== null);
		return json({ models });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 502 });
	}
};
