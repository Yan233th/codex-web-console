#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(__filename), '..');

// Find a free port
function findFreePort(start = 5173) {
	return new Promise((resolvePort) => {
		const server = createServer();
		server.listen(start, '127.0.0.1', () => {
			const port = server.address().port;
			server.close(() => resolvePort(port));
		});
		server.on('error', () => resolvePort(findFreePort(start + 1)));
	});
}

async function main() {
	const port = await findFreePort();
	const proc = spawn('npx', ['vite', 'dev', '--host', '127.0.0.1', '--port', String(port), '--open'], {
		cwd: projectRoot,
		stdio: 'inherit',
		env: { ...process.env },
		shell: process.platform === 'win32'
	});

	proc.on('exit', (code) => process.exit(code ?? 0));
	process.on('SIGINT', () => proc.kill());
	process.on('SIGTERM', () => proc.kill());
}

main();
