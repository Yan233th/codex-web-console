import { error, json } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';

const encoder = new TextEncoder();

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

function readEventId(value: string | null): number {
	if (!value) return 0;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function readWaitMs(value: string | null): number {
	if (!value) return 25_000;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return 25_000;
	return Math.min(30_000, Math.floor(parsed));
}

function encodeEvent(id: number, event: unknown): Uint8Array {
	return encoder.encode(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`);
}

export const GET = async ({ locals, request, url }) => {
	requireAuth(locals);

	const requestedSince = url.searchParams.get('since') ?? request.headers.get('last-event-id');
	const since = requestedSince === null ? codex.getLatestEventId() : readEventId(requestedSince);

	if (url.searchParams.get('transport') === 'poll') {
		const events = await codex.waitForEvents(since, readWaitMs(url.searchParams.get('wait')), request.signal);
		return json(
			{ events, latestId: codex.getLatestEventId() },
			{ headers: { 'Cache-Control': 'no-store, no-transform' } }
		);
	}

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			let unsubscribe = () => {};
			let keepAlive: ReturnType<typeof setInterval> | null = null;

			const close = () => {
				if (closed) {
					return;
				}

				closed = true;
				if (keepAlive !== null) clearInterval(keepAlive);
				unsubscribe();

				try {
					controller.close();
				} catch {
					// Ignore double-close and already-closed stream errors.
				}
			};

			try {
				controller.enqueue(encoder.encode(': connected\n\n'));
			} catch {
				close();
				return;
			}

			for (const { id, event } of codex.getEventsSince(since)) {
				try {
					controller.enqueue(encodeEvent(id, event));
				} catch {
					close();
					return;
				}
			}

			unsubscribe = codex.subscribe((event, id) => {
				if (closed) {
					return;
				}

				try {
					controller.enqueue(encodeEvent(id, event));
				} catch {
					close();
				}
			});

			keepAlive = setInterval(() => {
				if (closed) {
					return;
				}

				try {
					controller.enqueue(encoder.encode(': keepalive\n\n'));
				} catch {
					close();
				}
			}, 15000);

			request.signal.addEventListener('abort', close);
		},
		cancel() {
			// Svelte/undici can abort the request and cancel the stream separately.
			// Cleanup is handled by the abort listener and guarded against double-close.
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-store, no-transform',
			'X-Accel-Buffering': 'no',
			Connection: 'keep-alive'
		}
	});
};
