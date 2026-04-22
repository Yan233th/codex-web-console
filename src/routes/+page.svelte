<script lang="ts">
import { enhance } from '$app/forms';
import { goto } from '$app/navigation';
import { tick } from 'svelte';
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
	let runtimeReasoning = $state<Record<string, TimelineEntry[]>>({});
	let approvals = $state<ApprovalRequest[]>([]);
	let browserOpen = $state(false);
	let listing = $state<DirectoryListing | null>(null);
	let workspacePath = $state('');
	let newPrompt = $state('');
	let replyPrompt = $state('');
	let providerFilter = $state('all');
	let sidebarCollapsed = $state(false);
	let draftingThread = $state(false);
	let errorMessage = $state<string | null>(null);
	let bootErrorMessage = $state<string | null>(null);
	let loadingThread = $state(false);
	let submitting = $state(false);
	let source: EventSource | null = null;
	let mainScroller = $state<HTMLElement | null>(null);
	let autoScrolledThreadId = $state<string | null>(null);
	let activeTurnIndex = $state(0);
	let turnNavigationLockUntil = $state(0);
	let scrollRestoreLockUntil = $state(0);
	let followLiveOutput = $state(true);
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
	const runtimeReasoningList = $derived(
		visibleSelectedThreadId ? (runtimeReasoning[visibleSelectedThreadId] ?? []) : []
	);
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
	const visibleErrorMessage = $derived(errorMessage ?? bootErrorMessage);
	const showingDraftThread = $derived(draftingThread || (!visibleSelectedThread && !loadingThread));
	const selectedSummary = $derived(
		visibleThreads.find((thread) => thread.id === visibleSelectedThreadId) ?? null
	);
	const historicalTurns = $derived(visibleSelectedThread?.turns ?? []);
	const hasHistoricalTurns = $derived(historicalTurns.length > 0);
	const enhanceRedirect: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true });
				return;
			}

			await update();
		};
	};

	function threadHref(threadId: string | null): string {
		if (!threadId) {
			return '/';
		}

		const params = new URLSearchParams({ thread: threadId });
		return `/?${params.toString()}`;
	}

	async function openThread(threadId: string | null): Promise<void> {
		if (!threadId) {
			selectedThreadId = null;
			selectedThread = null;
			draftingThread = true;
			followLiveOutput = true;
			errorMessage = null;
			liveEntries = {};
			approvals = [];
			replyPrompt = '';
			await goto(threadHref(null), {
				keepFocus: true,
				noScroll: true
			});
			return;
		}

		draftingThread = false;
		selectedThreadId = threadId;
		followLiveOutput = true;
		errorMessage = null;
		await goto(threadHref(threadId), {
			keepFocus: true,
			noScroll: true
		});
	}

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
				text:
					(base.kind === 'reasoning' || patch.kind === 'reasoning') && base.text && !patch.text
						? base.text
						: (patch.text ?? base.text ?? ''),
				output: patch.output ?? base.output ?? ''
			}
		};
	}

	function rememberRuntimeReasoning(threadId: string): void {
		const entries = Object.values(liveEntries).filter(
			(entry) => entry.kind === 'reasoning' && entry.text?.trim()
		);

		if (entries.length === 0) {
			return;
		}

		const merged = new Map(
			(runtimeReasoning[threadId] ?? []).map((entry) => [entry.id, entry] as const)
		);

		for (const entry of entries) {
			merged.set(entry.id, entry);
		}

		runtimeReasoning = {
			...runtimeReasoning,
			[threadId]: [...merged.values()]
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
		selectedThreadId = data.selectedThread?.thread.id ?? null;
		approvals = data.selectedThread?.approvals ?? [];
		workspacePath = data.selectedThread?.thread.cwd ?? String(data.homePath);
		draftingThread = !data.selectedThread;
		bootErrorMessage = data.codexError ? String(data.codexError) : null;
	});

	async function loadThreads(): Promise<void> {
		const payload = await readJson<{ threads: ThreadSummary[] }>(await fetch('/api/threads'));
		bootErrorMessage = null;
		threads = payload.threads;
	}

	type ScrollSnapshot =
		| {
				mode: 'window';
				top: number;
				stickToBottom: boolean;
		  }
		| {
				mode: 'element';
				top: number;
				stickToBottom: boolean;
		  };

	function captureScrollSnapshot(): ScrollSnapshot | null {
		if (!mainScroller) {
			return null;
		}

		if (getComputedStyle(mainScroller).overflowY === 'visible') {
			const top = window.scrollY;
			const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
			return {
				mode: 'window',
				top,
				stickToBottom: maxTop - top < 80
			};
		}

		const top = mainScroller.scrollTop;
		const maxTop = Math.max(0, mainScroller.scrollHeight - mainScroller.clientHeight);
		return {
			mode: 'element',
			top,
			stickToBottom: maxTop - top < 80
		};
	}

	function restoreScrollSnapshot(snapshot: ScrollSnapshot | null): void {
		if (!snapshot || !mainScroller) {
			return;
		}

		scrollRestoreLockUntil = Date.now() + 300;

		if (snapshot.mode === 'window') {
			window.scrollTo({
				top: snapshot.stickToBottom ? document.documentElement.scrollHeight : snapshot.top,
				behavior: 'auto'
			});
			return;
		}

		mainScroller.scrollTo({
			top: snapshot.stickToBottom ? mainScroller.scrollHeight : snapshot.top,
			behavior: 'auto'
		});
	}

	function isNearBottom(): boolean {
		if (!mainScroller) {
			return true;
		}

		if (getComputedStyle(mainScroller).overflowY === 'visible') {
			const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
			return maxTop - window.scrollY < 96;
		}

		const maxTop = Math.max(0, mainScroller.scrollHeight - mainScroller.clientHeight);
		return maxTop - mainScroller.scrollTop < 96;
	}

	async function loadThread(
		threadId: string,
		options: { silent?: boolean } = {}
	): Promise<void> {
		const silent = options.silent ?? false;
		const snapshot = silent ? captureScrollSnapshot() : null;

		if (!silent) {
			loadingThread = true;
		} else {
			rememberRuntimeReasoning(threadId);
		}

		try {
			const payload = await readJson<{ detail: ThreadDetail }>(
				await fetch(`/api/threads/${threadId}`)
			);
			bootErrorMessage = null;
			errorMessage = null;
			selectedThread = payload.detail;
			approvals = payload.detail.approvals;
			liveEntries = {};

			if (silent) {
				await tick();
				restoreScrollSnapshot(snapshot);
				await new Promise<void>((resolve) => {
					requestAnimationFrame(() => {
						restoreScrollSnapshot(snapshot);
						resolve();
					});
				});
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			if (!silent) {
				loadingThread = false;
			}
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
			followLiveOutput = true;
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
			bootErrorMessage = null;
			newPrompt = '';
			draftingThread = false;
			await loadThreads();
			await openThread(payload.thread.id);
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
		followLiveOutput = true;
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
			bootErrorMessage = null;
			replyPrompt = '';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			submitting = false;
		}
	}

	function startDraftThread(): void {
		draftingThread = true;
		followLiveOutput = true;
		errorMessage = null;
		liveEntries = {};
		approvals = [];
		newPrompt = '';
		replyPrompt = '';
		workspacePath = visibleSelectedThread?.thread.cwd ?? String(data.homePath);
		void openThread(null);
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
		bootErrorMessage = null;
	}

	function submitOnEnter(event: KeyboardEvent, submit: () => void): void {
		if (event.key !== 'Enter' || event.isComposing || event.shiftKey || event.ctrlKey) {
			return;
		}

		event.preventDefault();
		submit();
	}

	function scrollMainTo(position: 'top' | 'bottom', behavior: ScrollBehavior = 'smooth'): void {
		if (!mainScroller) {
			return;
		}

		if (getComputedStyle(mainScroller).overflowY === 'visible') {
			window.scrollTo({
				top: position === 'top' ? 0 : document.documentElement.scrollHeight,
				behavior
			});
			return;
		}

		mainScroller.scrollTo({
			top: position === 'top' ? 0 : mainScroller.scrollHeight,
			behavior
		});
	}

	function getHistoricalTurnElements(): HTMLElement[] {
		if (!mainScroller) {
			return [];
		}

		return [...mainScroller.querySelectorAll<HTMLElement>('[data-turn-id]')];
	}

	function measureActiveTurnIndex(): number {
		const turnElements = getHistoricalTurnElements();
		if (turnElements.length === 0 || !mainScroller) {
			return -1;
		}

		const threshold =
			getComputedStyle(mainScroller).overflowY === 'visible'
				? 24
				: mainScroller.getBoundingClientRect().top + 24;

		let nextIndex = 0;
		for (const [index, element] of turnElements.entries()) {
			if (element.getBoundingClientRect().top <= threshold) {
				nextIndex = index;
				continue;
			}

			break;
		}

		return nextIndex;
	}

	function syncActiveTurnIndex(): void {
		if (Date.now() < turnNavigationLockUntil) {
			return;
		}

		const nextIndex = measureActiveTurnIndex();
		if (nextIndex >= 0) {
			activeTurnIndex = nextIndex;
		}
	}

	function scrollTurnIntoView(index: number): void {
		const turnElements = getHistoricalTurnElements();
		const element = turnElements[index];
		if (!element || !mainScroller) {
			return;
		}

		turnNavigationLockUntil = Date.now() + 450;

		const offset = 24;
		if (getComputedStyle(mainScroller).overflowY === 'visible') {
			window.scrollTo({
				top: window.scrollY + element.getBoundingClientRect().top - offset,
				behavior: 'smooth'
			});
		} else {
			mainScroller.scrollTo({
				top:
					mainScroller.scrollTop +
					element.getBoundingClientRect().top -
					mainScroller.getBoundingClientRect().top -
					offset,
				behavior: 'smooth'
			});
		}

		activeTurnIndex = index;
	}

	function jumpTurn(direction: 'previous' | 'next'): void {
		const turnCount = historicalTurns.length;
		if (turnCount === 0) {
			return;
		}

		const targetIndex =
			direction === 'previous'
				? Math.max(0, activeTurnIndex - 1)
				: Math.min(turnCount - 1, activeTurnIndex + 1);

		scrollTurnIntoView(targetIndex);
	}

	function maybeFollowLiveOutput(threadId: string): void {
		if (threadId !== selectedThreadId || !followLiveOutput) {
			return;
		}

		void tick().then(() => {
			if (!followLiveOutput) {
				return;
			}

			scrollMainTo('bottom', 'auto');
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
				void loadThread(event.threadId, { silent: true });
			}
			return;
		}

		if (event.type === 'item.started' || event.type === 'item.completed') {
			updateLiveEntry(event.item.id, event.threadId, event.item);
			maybeFollowLiveOutput(event.threadId);
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
			maybeFollowLiveOutput(event.threadId);
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
			maybeFollowLiveOutput(event.threadId);
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
			maybeFollowLiveOutput(event.threadId);
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
			maybeFollowLiveOutput(event.threadId);
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
		if (!authenticated || loadingThread || draftingThread) {
			return;
		}

		const threadId = selectedThread?.thread.id ?? data.selectedThread?.thread.id ?? null;
		if (!threadId || threadId === autoScrolledThreadId) {
			return;
		}

		autoScrolledThreadId = threadId;
		void tick().then(() => {
			scrollMainTo('bottom');
		});
	});

	$effect(() => {
		if (!authenticated || !mainScroller || showingDraftThread) {
			return;
		}

		const target =
			getComputedStyle(mainScroller).overflowY === 'visible' ? window : mainScroller;
		const handleScroll = () => {
			if (Date.now() < scrollRestoreLockUntil) {
				return;
			}

			followLiveOutput = isNearBottom();
			if (historicalTurns.length > 0) {
				syncActiveTurnIndex();
			}
		};

		void tick().then(() => {
			handleScroll();
		});

		target.addEventListener('scroll', handleScroll, { passive: true });
		window.addEventListener('resize', handleScroll);

		return () => {
			target.removeEventListener('scroll', handleScroll);
			window.removeEventListener('resize', handleScroll);
		};
	});

	$effect(() => {
		if (!authenticated) {
			return;
		}

		if (allThreads.length === 0) {
			selectedThreadId = null;
			selectedThread = null;
			approvals = [];
			liveEntries = {};
			draftingThread = true;
			return;
		}

		if (selectedThreadId && !allThreads.some((thread) => thread.id === selectedThreadId)) {
			selectedThreadId = null;
			selectedThread = null;
			approvals = [];
			liveEntries = {};
			draftingThread = true;
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
						class="ghost floating-button sidebar-toggle-button"
						onclick={() => {
							sidebarCollapsed = true;
						}}
						aria-label="Collapse sidebar"
						title="Collapse sidebar"
					>
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<path
								d="M4.5 4.5h11v11h-11zM12 4.5v11M9 7.25 6.25 10 9 12.75"
								fill="none"
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.6"
							/>
						</svg>
					</button>
				</div>
			</div>

			<button type="button" class="sidebar-primary-action" onclick={startDraftThread}>
				New thread
			</button>

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
				selectedThreadId={draftingThread ? null : visibleSelectedThreadId}
				onSelect={(threadId) => void openThread(threadId)}
			/>
		</aside>

		{#if sidebarCollapsed}
			<button
				type="button"
				class="ghost floating-button sidebar-reopen"
				onclick={() => {
					sidebarCollapsed = false;
				}}
				aria-label="Expand sidebar"
				title="Expand sidebar"
			>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path
						d="M4.5 4.5h11v11h-11zM8 4.5v11M11 7.25 13.75 10 11 12.75"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="1.6"
					/>
				</svg>
			</button>
		{/if}

		<main bind:this={mainScroller} class="main">
			<section class="thread-workspace detail-layout">
				<div class="detail-header">
					<div>
						<p class="eyebrow">{showingDraftThread ? 'New thread' : 'Thread'}</p>
						<h2
							class="detail-title"
							title={showingDraftThread
								? 'Start a conversation'
								: (selectedSummary?.title ?? 'Nothing selected')}
						>
							{showingDraftThread
								? 'Start a conversation'
								: (selectedSummary?.title ?? 'Nothing selected')}
						</h2>
						{#if !showingDraftThread && selectedSummary}
							<p class="copy">{selectedSummary.cwd}</p>
							{#if selectedSummary.provider}
								<p class="detail-provider">{selectedSummary.provider}</p>
							{/if}
						{:else if showingDraftThread}
							<p class="copy">Pick a workspace, write the first message, and start here.</p>
						{/if}
					</div>
					{#if showingDraftThread}
						<button
							type="button"
							class="ghost"
							onclick={() => void openBrowser(workspacePath || visibleWorkspacePath)}
						>
							Browse
						</button>
					{/if}
				</div>

				{#if showingDraftThread}
					<div class="detail-body compose-view">
						<div class="compose-panel">
							<label class="field">
								<span>Workspace</span>
								<input bind:value={workspacePath} spellcheck="false" />
							</label>

							<label class="field composer-prompt">
								<span>Message</span>
								<textarea
									bind:value={newPrompt}
									rows="8"
									onkeydown={(event) => submitOnEnter(event, () => void createThread())}
								></textarea>
							</label>

							<div class="compose-actions">
								<button type="button" onclick={() => void createThread()} disabled={submitting}>
									Start thread
								</button>
							</div>

							{#if visibleErrorMessage}
								<p class="error workspace-error">{visibleErrorMessage}</p>
							{/if}
						</div>
					</div>
				{:else if loadingThread}
					<p class="copy">Loading thread…</p>
				{:else}
					<div class="detail-body">
						<Timeline
							turns={visibleSelectedThread?.turns ?? []}
							liveEntries={liveEntryList}
							preservedEntries={runtimeReasoningList}
							{approvals}
						/>
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

				{#if !showingDraftThread && visibleSelectedThread}
					<div class="reply-box composer-surface">
						{#if visibleErrorMessage}
							<p class="error workspace-error">{visibleErrorMessage}</p>
						{/if}
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

		{#if !browserOpen}
			<div class="screen-tools" role="group" aria-label="Page controls">
				<button
					type="button"
					class="ghost floating-button"
					aria-label="Scroll to top"
					title="Scroll to top"
					onclick={() => scrollMainTo('top')}
				>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path
							d="M5 8.75 10 4l5 4.75M5 13.75 10 9l5 4.75"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.7"
						/>
					</svg>
				</button>

				{#if !showingDraftThread}
					<button
						type="button"
						class="ghost floating-button"
						aria-label="Previous turn"
						title="Previous turn"
						disabled={!hasHistoricalTurns || activeTurnIndex <= 0}
						onclick={() => jumpTurn('previous')}
					>
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<path
								d="M12.5 6 7.5 10l5 4"
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
						class="ghost floating-button"
						aria-label="Next turn"
						title="Next turn"
						disabled={!hasHistoricalTurns || activeTurnIndex >= historicalTurns.length - 1}
						onclick={() => jumpTurn('next')}
					>
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<path
								d="M7.5 6 12.5 10l-5 4"
								fill="none"
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="1.7"
							/>
						</svg>
					</button>
				{/if}

				<button
					type="button"
					class="ghost floating-button"
					aria-label="Scroll to bottom"
					title="Scroll to bottom"
					onclick={() => scrollMainTo('bottom')}
				>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path
							d="M5 6.25 10 11l5-4.75M5 11.25 10 16l5-4.75"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.7"
						/>
					</svg>
				</button>

				<form method="POST" action="?/logout" use:enhance={enhanceRedirect} class="logout-form">
					<button type="submit" class="ghost floating-button" aria-label="Log out" title="Log out">
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
		{/if}
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
