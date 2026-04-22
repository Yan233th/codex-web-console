import { error } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

export const GET = async ({ locals, request }) => {
	requireAuth(locals);

	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;

			const close = () => {
				if (closed) {
					return;
				}

				closed = true;
				clearInterval(keepAlive);
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

			const unsubscribe = codex.subscribe((event) => {
				if (closed) {
					return;
				}

				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
				} catch {
					close();
				}
			});

			const keepAlive = setInterval(() => {
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
			'Cache-Control': 'no-store',
			Connection: 'keep-alive'
		}
	});
};
