<script lang="ts">
import { enhance } from '$app/forms';
import { goto } from '$app/navigation';
import type { SubmitFunction } from '@sveltejs/kit';

	import LoginView from '$lib/components/LoginView.svelte';
	import ThreadList from '$lib/components/ThreadList.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import WorkspaceBrowser from '$lib/components/WorkspaceBrowser.svelte';
	import type {
		ApprovalRequest,
		ConsoleEvent,
		DirectoryListing,
		ThreadDetail,
		ThreadSummary,
		TimelineEntry
	} from '$lib/types';

	let {
		data,
		form
	}: {
		data: {
			authenticated: boolean;
			tokenConfigured: boolean;
			fallbackTokenActive: boolean;
			threads: ThreadSummary[];
			selectedThread: ThreadDetail | null;
			homePath: string;
			codexError: string | null;
		};
		form?: {
			loginError?: string;
		};
	} = $props();

	const authenticated = $derived(Boolean(data.authenticated));

	let threads = $state<ThreadSummary[]>([]);
	let selectedThreadId = $state<string | null>(null);
	let selectedThread = $state<ThreadDetail | null>(null);
	let liveEntries = $state<Record<string, TimelineEntry>>({});
	let approvals = $state<ApprovalRequest[]>([]);
	let browserOpen = $state(false);
	let listing = $state<DirectoryListing | null>(null);
	let workspacePath = $state('');
	let newPrompt = $state('');
	let replyPrompt = $state('');
	let providerFilter = $state('all');
	let sidebarCollapsed = $state(false);
	let errorMessage = $state<string | null>(null);
	let loadingThread = $state(false);
	let submitting = $state(false);
	let source: EventSource | null = null;
	let mainScroller = $state<HTMLElement | null>(null);
	const liveEntryList = $derived(Object.values(liveEntries));
	const allThreads = $derived(threads.length > 0 ? threads : data.threads);
	const providerOptions = $derived.by(() => {
		const options = new Set<string>();

		for (const thread of allThreads) {
			if (thread.provider) {
				options.add(thread.provider);
			}
		}

		return ['all', ...[...options].sort((left, right) => left.localeCompare(right))];
	});
	const visibleThreads = $derived(
		providerFilter === 'all'
			? allThreads
			: allThreads.filter((thread) => thread.provider === providerFilter)
	);
	const visibleSelectedThreadId = $derived.by(() => {
		if (selectedThreadId) {
			return selectedThreadId;
		}

		const initialThreadId = data.selectedThread?.thread.id ?? null;
		if (initialThreadId && visibleThreads.some((thread) => thread.id === initialThreadId)) {
			return initialThreadId;
		}

		return visibleThreads[0]?.id ?? null;
	});
	const visibleSelectedThread = $derived.by(() => {
		if (selectedThread?.thread.id === visibleSelectedThreadId) {
			return selectedThread;
		}

		if (data.selectedThread?.thread.id === visibleSelectedThreadId) {
			return data.selectedThread;
		}

		return null;
	});
	const visibleWorkspacePath = $derived(
		workspacePath || data.selectedThread?.thread.cwd || String(data.homePath)
	);
	const visibleErrorMessage = $derived(
		errorMessage ?? (data.codexError ? String(data.codexError) : null)
	);
	const selectedSummary = $derived(
		visibleThreads.find((thread) => thread.id === visibleSelectedThreadId) ?? null
	);
	const enhanceRedirect: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true });
				return;
			}

			await update();
		};
	};

	function updateLiveEntry(
		itemId: string,
		threadId: string,
		patch: Partial<TimelineEntry>,
		defaults?: Pick<TimelineEntry, 'kind' | 'label'>
	): void {
		if (threadId !== selectedThreadId) {
			return;
		}

		const current = liveEntries[itemId];
		const base =
			current ??
			(defaults
				? {
						id: itemId,
						...defaults,
						text: '',
						output: ''
					}
				: {
						id: itemId,
						kind: 'system' as const,
						label: 'System',
						text: '',
						output: ''
					});

		liveEntries = {
			...liveEntries,
			[itemId]: {
				...base,
				...patch,
				text: patch.text ?? base.text ?? '',
				output: patch.output ?? base.output ?? ''
			}
		};
	}

	async function readJson<T>(response: Response): Promise<T> {
		if (!response.ok) {
			const payload = (await response.json().catch(() => null)) as { error?: string } | null;
			throw new Error(payload?.error ?? `Request failed: ${response.status}`);
		}

		return response.json() as Promise<T>;
	}

	$effect(() => {
		threads = [...data.threads];
		selectedThread = data.selectedThread;
		selectedThreadId = data.selectedThread?.thread.id ?? data.threads[0]?.id ?? null;
		approvals = data.selectedThread?.approvals ?? [];
		workspacePath = data.selectedThread?.thread.cwd ?? String(data.homePath);
		errorMessage = data.codexError ? String(data.codexError) : null;
	});

	async function loadThreads(): Promise<void> {
		const payload = await readJson<{ threads: ThreadSummary[] }>(await fetch('/api/threads'));
		threads = payload.threads;
		if (!selectedThreadId && threads[0]) {
			selectedThreadId = threads[0].id;
		}
	}

	async function loadThread(threadId: string): Promise<void> {
		loadingThread = true;
		try {
			const payload = await readJson<{ detail: ThreadDetail }>(
				await fetch(`/api/threads/${threadId}`)
			);
			selectedThread = payload.detail;
			approvals = payload.detail.approvals;
			liveEntries = {};
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			loadingThread = false;
		}
	}

	async function openBrowser(path: string): Promise<void> {
		const payload = await readJson<{ listing: DirectoryListing }>(
			await fetch(`/api/fs?path=${encodeURIComponent(path)}`)
		);
		listing = payload.listing;
		browserOpen = true;
	}

	async function createThread(): Promise<void> {
		if (!workspacePath.trim() || !newPrompt.trim()) {
			errorMessage = 'Workspace path and prompt are required.';
			return;
		}

		submitting = true;
		errorMessage = null;

		try {
			const payload = await readJson<{ thread: ThreadSummary }>(
				await fetch('/api/threads', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						cwd: workspacePath,
						prompt: newPrompt
					})
				})
			);
			newPrompt = '';
			await loadThreads();
			selectedThreadId = payload.thread.id;
			await loadThread(payload.thread.id);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			submitting = false;
		}
	}

	async function sendReply(): Promise<void> {
		if (!selectedThread || !replyPrompt.trim()) {
			return;
		}

		submitting = true;
		errorMessage = null;

		try {
			await readJson<{ ok: true }>(
				await fetch(`/api/threads/${selectedThread.thread.id}/messages`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						cwd: selectedThread.thread.cwd,
						prompt: replyPrompt
					})
				})
			);
			replyPrompt = '';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			submitting = false;
		}
	}

	async function resolveApproval(
		requestId: string,
		decision: 'accept' | 'acceptForSession' | 'decline'
	): Promise<void> {
		await readJson<{ ok: true }>(
			await fetch(`/api/approvals/${requestId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ decision })
			})
		);
	}

	function submitOnEnter(event: KeyboardEvent, submit: () => void): void {
		if (event.key !== 'Enter' || event.isComposing || event.shiftKey || event.ctrlKey) {
			return;
		}

		event.preventDefault();
		submit();
	}

	function scrollMainTo(position: 'top' | 'bottom'): void {
		if (!mainScroller) {
			return;
		}

		mainScroller.scrollTo({
			top: position === 'top' ? 0 : mainScroller.scrollHeight,
			behavior: 'smooth'
		});
	}

	function handleEvent(event: ConsoleEvent): void {
		if (event.type === 'thread.started') {
			void loadThreads();
			return;
		}

		if (event.type === 'approval.requested') {
			if (event.threadId === selectedThreadId) {
				approvals = [...approvals.filter((item) => item.requestId !== event.approval.requestId), event.approval];
			}
			return;
		}

		if (event.type === 'approval.resolved') {
			approvals = approvals.filter((item) => item.requestId !== event.requestId);
			return;
		}

		if (event.type === 'turn.completed') {
			void loadThreads();
			if (event.threadId === selectedThreadId) {
				void loadThread(event.threadId);
			}
			return;
		}

		if (event.type === 'item.started' || event.type === 'item.completed') {
			updateLiveEntry(event.item.id, event.threadId, event.item);
			return;
		}

		if (event.type === 'message.delta') {
			const current = liveEntries[event.itemId];
			updateLiveEntry(
				event.itemId,
				event.threadId,
				{ text: `${current?.text ?? ''}${event.delta}` },
				{ kind: 'assistant', label: 'Assistant' }
			);
			return;
		}

		if (event.type === 'reasoning.delta') {
			const current = liveEntries[event.itemId];
			updateLiveEntry(
				event.itemId,
				event.threadId,
				{ text: `${current?.text ?? ''}${event.delta}` },
				{ kind: 'reasoning', label: 'Reasoning' }
			);
			return;
		}

		if (event.type === 'command.delta') {
			const current = liveEntries[event.itemId];
			updateLiveEntry(
				event.itemId,
				event.threadId,
				{ output: `${current?.output ?? ''}${event.delta}` },
				{ kind: 'command', label: 'Command' }
			);
			return;
		}

		if (event.type === 'file_change.delta') {
			const current = liveEntries[event.itemId];
			updateLiveEntry(
				event.itemId,
				event.threadId,
				{ text: `${current?.text ?? ''}${event.delta}` },
				{ kind: 'file_change', label: 'File change' }
			);
			return;
		}

		if (event.type === 'error') {
			errorMessage = event.message;
		}
	}

	$effect(() => {
		source?.close();
		source = null;

		if (!authenticated) {
			return;
		}

		const nextSource = new EventSource('/api/events');
		nextSource.onmessage = (raw) => {
			handleEvent(JSON.parse(raw.data) as ConsoleEvent);
		};
		nextSource.onerror = () => {
			errorMessage = 'Live connection dropped.';
		};

		source = nextSource;

		return () => {
			nextSource.close();
			if (source === nextSource) {
				source = null;
			}
		};
	});

	$effect(() => {
		if (authenticated && selectedThreadId && selectedThread?.thread.id !== selectedThreadId) {
			void loadThread(selectedThreadId);
		}
	});

	$effect(() => {
		if (!authenticated) {
			return;
		}

		if (visibleThreads.length === 0) {
			selectedThreadId = null;
			selectedThread = null;
			approvals = [];
			liveEntries = {};
			return;
		}

		if (!visibleThreads.some((thread) => thread.id === selectedThreadId)) {
			selectedThreadId = visibleThreads[0]?.id ?? null;
		}
	});
</script>

{#if !authenticated}
	<div class="login-shell">
		<LoginView
			tokenConfigured={data.tokenConfigured}
			fallbackTokenActive={data.fallbackTokenActive}
			loginError={form?.loginError}
		/>
	</div>
{:else}
	<div class:sidebar-collapsed={sidebarCollapsed} class="app-shell">
		<aside class="sidebar">
			<div class="brand">
				<div>
					<p class="eyebrow">Codex Web Console</p>
					<h1>Local</h1>
				</div>
				<div class="brand-actions">
					<button
						type="button"
						class="ghost icon-button"
						onclick={() => {
							sidebarCollapsed = true;
						}}
						aria-label="Collapse sidebar"
					>
						<span aria-hidden="true">←</span>
					</button>
				</div>
			</div>

			<label class="field sidebar-filter">
				<span>Provider</span>
				<select bind:value={providerFilter}>
					{#each providerOptions as provider}
						<option value={provider}>
							{provider === 'all' ? 'All providers' : provider}
						</option>
					{/each}
				</select>
			</label>

			<ThreadList
				threads={visibleThreads}
				selectedThreadId={visibleSelectedThreadId}
				onSelect={(threadId) => {
					selectedThreadId = threadId;
				}}
			/>
		</aside>

		<main bind:this={mainScroller} class="main">
			<div class="main-fab-row">
				{#if sidebarCollapsed}
					<button
						type="button"
						class="ghost icon-button sidebar-toggle"
						onclick={() => {
							sidebarCollapsed = false;
						}}
						aria-label="Expand sidebar"
					>
						<span aria-hidden="true">→</span>
					</button>
				{/if}
			</div>

			<section class="composer-card composer-compact">
				<div class="composer-header">
					<div>
						<p class="eyebrow">New thread</p>
						<h2>Start in one step</h2>
					</div>
					<button
						type="button"
						class="ghost"
						onclick={() => void openBrowser(workspacePath || visibleWorkspacePath)}
					>
						Browse
					</button>
				</div>

				<div class="composer-grid">
					<label class="field">
						<span>Workspace</span>
						<input bind:value={workspacePath} spellcheck="false" />
					</label>

					<label class="field composer-prompt">
						<span>Prompt</span>
						<textarea
							bind:value={newPrompt}
							rows="3"
							onkeydown={(event) => submitOnEnter(event, () => void createThread())}
						></textarea>
					</label>

					<div class="composer-actions">
						<button type="button" onclick={() => void createThread()} disabled={submitting}>
							Start thread
						</button>
					</div>
				</div>
			</section>

			<section class="thread-workspace detail-layout">
				<div class="detail-header">
					<div>
						<p class="eyebrow">Thread</p>
						<h2>{selectedSummary?.title ?? 'Nothing selected'}</h2>
						{#if selectedSummary}
							<p class="copy">{selectedSummary.cwd}</p>
							{#if selectedSummary.provider}
								<p class="detail-provider">{selectedSummary.provider}</p>
							{/if}
						{/if}
					</div>
				</div>

				{#if visibleErrorMessage}
					<p class="error">{visibleErrorMessage}</p>
				{/if}

				{#if loadingThread}
					<p class="copy">Loading thread…</p>
				{:else}
					<div class="detail-body">
						<Timeline turns={visibleSelectedThread?.turns ?? []} liveEntries={liveEntryList} {approvals} />
					</div>

					{#if approvals.length > 0}
						<div class="approval-actions">
							{#each approvals as approval (approval.requestId)}
								<div class="approval-buttons">
									<button type="button" onclick={() => void resolveApproval(approval.requestId, 'accept')}>
										Allow once
									</button>
									<button
										type="button"
										class="ghost"
										onclick={() => void resolveApproval(approval.requestId, 'acceptForSession')}
									>
										Allow for session
									</button>
									<button
										type="button"
										class="danger"
										onclick={() => void resolveApproval(approval.requestId, 'decline')}
									>
										Decline
									</button>
								</div>
							{/each}
						</div>
					{/if}
				{/if}

				{#if visibleSelectedThread}
					<div class="reply-box composer-surface">
						<label class="field">
							<span>Reply</span>
							<textarea
								bind:value={replyPrompt}
								rows="4"
								onkeydown={(event) => submitOnEnter(event, () => void sendReply())}
							></textarea>
						</label>
						<button type="button" onclick={() => void sendReply()} disabled={submitting}>Send</button>
					</div>
				{/if}
			</section>
		</main>

		<div class="screen-tools">
			<button
				type="button"
				class="ghost icon-button topbar-button"
				aria-label="Scroll to top"
				title="Scroll to top"
				onclick={() => scrollMainTo('top')}
			>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path
						d="M5 7.75 10 3l5 4.75M10 4v12"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.7"
					/>
				</svg>
			</button>

			<button
				type="button"
				class="ghost icon-button topbar-button"
				aria-label="Scroll to bottom"
				title="Scroll to bottom"
				onclick={() => scrollMainTo('bottom')}
			>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path
						d="M5 12.25 10 17l5-4.75M10 16V4"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.7"
					/>
				</svg>
			</button>

			<form method="POST" action="?/logout" use:enhance={enhanceRedirect} class="logout-form">
				<button type="submit" class="ghost icon-button topbar-button" aria-label="Log out" title="Log out">
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path
							d="M8 3.5H5.75A2.25 2.25 0 0 0 3.5 5.75v8.5A2.25 2.25 0 0 0 5.75 16.5H8"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.7"
						/>
						<path
							d="M11 6.25 15 10l-4 3.75M15 10H7.5"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.7"
						/>
					</svg>
				</button>
			</form>
		</div>
	</div>

	<WorkspaceBrowser
		open={browserOpen}
		{listing}
		selectedPath={workspacePath}
		onClose={() => {
			browserOpen = false;
		}}
		onNavigate={(nextPath) => void openBrowser(nextPath)}
		onSelect={(nextPath) => {
			workspacePath = nextPath;
			browserOpen = false;
		}}
	/>
{/if}
