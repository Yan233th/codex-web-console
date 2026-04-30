import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { error } from '@sveltejs/kit';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

const MIME_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.bmp': 'image/bmp',
	'.ico': 'image/x-icon',
	'.avif': 'image/avif'
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export const GET = async ({ locals, url, params }) => {
	requireAuth(locals);

	const filePath = url.searchParams.get('path')?.trim();
	const cwd = url.searchParams.get('cwd')?.trim();

	const decodedPath = filePath ? decodeURIComponent(filePath) : '';
	const decodedCwd = cwd ? decodeURIComponent(cwd) : '';

	if (!decodedPath) {
		return new Response('Missing path parameter', { status: 400 });
	}

	const normalizePath = (p: string) =>
		p.replace(/^file:\/\/\//i, '')
			.replace(/^file:\/\//i, '')
			.replace(/^file:/i, '')
			.replace(/^\/([a-zA-Z]:)/, '$1');

	const normalizedPath = normalizePath(decodedPath);
	const normalizedCwd = normalizePath(decodedCwd);

	const resolved = path.isAbsolute(normalizedPath)
		? normalizedPath
		: path.resolve(normalizedCwd || process.cwd(), normalizedPath);

	// Security: prevent path traversal
	const safeRoot = path.resolve(normalizedCwd || process.cwd());
	const resolvedPath = path.resolve(resolved);
	if (!resolvedPath.startsWith(safeRoot + path.sep) && resolvedPath !== safeRoot) {
		return new Response(null, { status: 403 });
	}


	try {
		const info = await stat(resolved);
		if (!info.isFile()) {
			return new Response('Not a file', { status: 400 });
		}
		if (info.size > MAX_FILE_SIZE) {
			return new Response('File too large', { status: 400 });
		}

		const ext = path.extname(resolved).toLowerCase();
		const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
		const body = await readFile(resolved);

		return new Response(body, {
			headers: {
				'Content-Type': contentType,
				'Content-Disposition': ext in MIME_TYPES ? 'inline' : 'attachment',
				'Cache-Control': 'private, max-age=3600'
			}
		});
	} catch {
		return new Response(null, { status: 404 });
	}
};
