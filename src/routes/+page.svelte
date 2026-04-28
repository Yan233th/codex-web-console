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

	// ── State ──
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
	let interrupting = $state(false);
	let source: EventSource | null = null;
	let mainScroller = $state<HTMLElement | null>(null);
	let autoScrolledThreadId = $state<string | null>(null);
	let activeTurnIndex = $state(0);
	let turnNavigationLockUntil = $state(0);
	let scrollRestoreLockUntil = $state(0);
	let followLiveOutput = $state(true);
	let liveConnectionState = $state<'connecting' | 'live' | 'reconnecting'>('connecting');
	// ── Derived ──
	const liveEntryList = $derived(Object.values(liveEntries));
	const allThreads = $derived(threads.length > 0 ? threads : data.threads);
	const providerOptions = $derived.by(() => {
		const options = new Set<string>();
		for (const thread of allThreads) {
			if (thread.provider) options.add(thread.provider);
		}
		return ['all', ...[...options].sort((a, b) => a.localeCompare(b))];
	});
	const visibleThreads = $derived(
		providerFilter === 'all'
			? allThreads
			: allThreads.filter((t) => t.provider === providerFilter)
	);
	const visibleSelectedThreadId = $derived.by(() => {
		if (selectedThreadId) return selectedThreadId;
		const id = data.selectedThread?.thread.id ?? null;
		if (id && visibleThreads.some((t) => t.id === id)) return id;
		return visibleThreads[0]?.id ?? null;
	});
	const runtimeReasoningList = $derived(
		visibleSelectedThreadId ? (runtimeReasoning[visibleSelectedThreadId] ?? []) : []
	);
	const visibleSelectedThread = $derived.by(() => {
		if (selectedThread?.thread.id === visibleSelectedThreadId) return selectedThread;
		if (data.selectedThread?.thread.id === visibleSelectedThreadId) return data.selectedThread;
		return null;
	});
	const visibleWorkspacePath = $derived(
		workspacePath || data.selectedThread?.thread.cwd || String(data.homePath)
	);
	const visibleErrorMessage = $derived(errorMessage ?? bootErrorMessage);
	const showingDraftThread = $derived(draftingThread || (!visibleSelectedThread && !loadingThread));
	const selectedSummary = $derived(
		visibleThreads.find((t) => t.id === visibleSelectedThreadId) ?? null
	);
	const historicalTurns = $derived(visibleSelectedThread?.turns ?? []);
	const hasHistoricalTurns = $derived(historicalTurns.length > 0);
	const fallbackRunningTurnId = $derived.by(() => {
		const turns = visibleSelectedThread?.turns ?? [];
		for (let i = turns.length - 1; i >= 0; i--) {
			if (turns[i].completedAt === null) return turns[i].id;
		}
		return null;
	});
	let runningTurnId = $state<string | null>(null);
	const interruptableTurnId = $derived(runningTurnId ?? fallbackRunningTurnId);

	const liveConnectionWarning = $derived.by(() => {
		if (!authenticated) return null;
		if (liveConnectionState === 'connecting') return 'Connecting…';
		if (liveConnectionState === 'reconnecting') return 'Disconnected. Reconnecting…';
		return null;
	});

	const enhanceRedirect: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true });
				return;
			}
			await update();
		};
	};

	// ── Theme ──
	let currentTheme = $state<'dark' | 'light'>('dark');

	$effect(() => {
		const saved = typeof localStorage !== 'undefined' ? (localStorage.getItem('theme') as 'dark' | 'light') : null;
		if (saved === 'dark' || saved === 'light') currentTheme = saved;
	});

	function cycleTheme() {
		const root = document.documentElement;
		const next: typeof currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
		localStorage.setItem('theme', next);
		root.classList.remove('light', 'dark');
		root.classList.add(next);
		currentTheme = next;
	}
	function threadHref(threadId: string | null): string {
		if (!threadId) return '/';
		return `/?${new URLSearchParams({ thread: threadId }).toString()}`;
	}

	async function openThread(threadId: string | null) {
		if (!threadId) {
			selectedThreadId = null;
			selectedThread = null;
			draftingThread = true;
			followLiveOutput = true;
			errorMessage = null;
			liveEntries = {};
			approvals = [];
			replyPrompt = '';
			await goto(threadHref(null), { keepFocus: true, noScroll: true });
			return;
		}
		draftingThread = false;
		selectedThreadId = threadId;
		followLiveOutput = true;
		errorMessage = null;
		await goto(threadHref(threadId), { keepFocus: true, noScroll: true });
	}

	function updateLiveEntry(itemId: string, threadId: string, patch: Partial<TimelineEntry>, defaults?: Pick<TimelineEntry, 'kind' | 'label'>) {
		if (threadId !== selectedThreadId) return;
		const current = liveEntries[itemId];
		const base = current ?? (defaults ? { id: itemId, ...defaults, text: '', output: '' } : { id: itemId, kind: 'system' as const, label: 'System', text: '', output: '' });
		liveEntries = {
			...liveEntries,
			[itemId]: {
				...base, ...patch,
				text: (base.kind === 'reasoning' || patch.kind === 'reasoning') && base.text && !patch.text ? base.text : (patch.text ?? base.text ?? ''),
				output: patch.output ?? base.output ?? ''
			}
		};
	}

	function rememberRuntimeReasoning(threadId: string) {
		const entries = Object.values(liveEntries).filter(e => e.kind === 'reasoning' && e.text?.trim());
		if (!entries.length) return;
		const merged = new Map((runtimeReasoning[threadId] ?? []).map(e => [e.id, e] as const));
		for (const e of entries) merged.set(e.id, e);
		runtimeReasoning = { ...runtimeReasoning, [threadId]: [...merged.values()] };
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
		runningTurnId = null;
		approvals = data.selectedThread?.approvals ?? [];
		workspacePath = data.selectedThread?.thread.cwd ?? String(data.homePath);
		draftingThread = !data.selectedThread;
		bootErrorMessage = data.codexError ? String(data.codexError) : null;
	});

	async function loadThreads() {
		const payload = await readJson<{ threads: ThreadSummary[] }>(await fetch('/api/threads'));
		bootErrorMessage = null;
		threads = payload.threads;
	}

	type ScrollSnapshot = { mode: 'window' | 'element'; top: number; stickToBottom: boolean };

	async function loadThread(threadId: string, options: { silent?: boolean } = {}) {
		const silent = options.silent ?? false;
		const snapshot = silent ? captureScrollSnapshot() : null;
		if (!silent) loadingThread = true;
		else rememberRuntimeReasoning(threadId);
		try {
			const payload = await readJson<{ detail: ThreadDetail }>(await fetch(`/api/threads/${threadId}`));
			bootErrorMessage = null;
			errorMessage = null;
			selectedThread = payload.detail;
			approvals = payload.detail.approvals;
			liveEntries = {};
			if (silent) {
				await tick();
				restoreScrollSnapshot(snapshot);
				await new Promise<void>(r => requestAnimationFrame(() => { restoreScrollSnapshot(snapshot); r(); }));
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			if (!silent) loadingThread = false;
		}
	}

	async function openBrowser(path: string) {
		const payload = await readJson<{ listing: DirectoryListing }>(await fetch(`/api/fs?path=${encodeURIComponent(path)}`));
		listing = payload.listing;
		browserOpen = true;
	}

	async function createThread() {
		if (!workspacePath.trim() || !newPrompt.trim()) { errorMessage = 'Workspace path and prompt are required.'; return; }
		submitting = true;
		errorMessage = null;
		try {
			followLiveOutput = true;
			const payload = await readJson<{ thread: ThreadSummary }>(await fetch('/api/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: workspacePath, prompt: newPrompt }) }));
			bootErrorMessage = null;
			newPrompt = '';
			draftingThread = false;
			await loadThreads();
			await openThread(payload.thread.id);
		} catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
		finally { submitting = false; }
	}

	async function sendReply() {
		if (!selectedThread || !replyPrompt.trim()) return;
		if (interruptableTurnId) { errorMessage = 'This turn is still running. Stop it before sending another reply.'; return; }
		submitting = true;
		followLiveOutput = true;
		errorMessage = null;
		try {
			await readJson<{ ok: true }>(await fetch(`/api/threads/${selectedThread.thread.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: selectedThread.thread.cwd, prompt: replyPrompt }) }));
			bootErrorMessage = null;
			replyPrompt = '';
		} catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
		finally { submitting = false; }
	}

	async function interruptCurrentTurn() {
		if (!selectedThread || !interruptableTurnId) return;
		interrupting = true;
		errorMessage = null;
		try {
			await readJson<{ ok: true }>(await fetch(`/api/threads/${selectedThread.thread.id}/interrupt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnId: interruptableTurnId }) }));
		} catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
		finally { interrupting = false; }
	}

	function startDraftThread() {
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

	async function resolveApproval(requestId: string, decision: 'accept' | 'acceptForSession' | 'decline') {
		await readJson<{ ok: true }>(await fetch(`/api/approvals/${requestId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) }));
		bootErrorMessage = null;
	}

	function submitOnEnter(event: KeyboardEvent, submit: () => void) {
		if (event.key !== 'Enter' || event.isComposing || event.shiftKey || event.ctrlKey) return;
		event.preventDefault();
		submit();
	}

	function scrollTarget(): HTMLElement | Window {
		if (!mainScroller) return window;
		const body = mainScroller.querySelector<HTMLElement>('.detail-body');
		if (body && getComputedStyle(body).overflowY !== 'visible') return body;
		return window;
	}

	function scrollMainTo(position: 'top' | 'bottom', behavior: ScrollBehavior = 'smooth') {
		const target = scrollTarget();
		if (target === window) {
			window.scrollTo({ top: position === 'top' ? 0 : document.documentElement.scrollHeight, behavior });
		} else {
			const element = target as HTMLElement;
			element.scrollTo({ top: position === 'top' ? 0 : element.scrollHeight, behavior });
		}
	}

	function getHistoricalTurnElements(): HTMLElement[] {
		if (!mainScroller) return [];
		return [...mainScroller.querySelectorAll<HTMLElement>('[data-turn-id]')];
	}

	function measureActiveTurnIndex(): number {
		const elements = getHistoricalTurnElements();
		if (!elements.length || !mainScroller) return -1;
		const target = scrollTarget();
		const threshold = target === window ? 24 : (target as HTMLElement).getBoundingClientRect().top + 24;
		let idx = 0;
		for (const [i, el] of elements.entries()) {
			if (el.getBoundingClientRect().top <= threshold) { idx = i; continue; }
			break;
		}
		return idx;
	}

	function syncActiveTurnIndex() {
		if (Date.now() < turnNavigationLockUntil) return;
		const next = measureActiveTurnIndex();
		if (next >= 0) activeTurnIndex = next;
	}

	function scrollTurnIntoView(index: number) {
		const elements = getHistoricalTurnElements();
		const el = elements[index];
		if (!el || !mainScroller) return;
		turnNavigationLockUntil = Date.now() + 450;
		const offset = 24;
		const target = scrollTarget();
		if (target === window) {
			window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - offset, behavior: 'smooth' });
		} else {
			const element = target as HTMLElement;
			element.scrollTo({ top: element.scrollTop + el.getBoundingClientRect().top - element.getBoundingClientRect().top - offset, behavior: 'smooth' });
		}
		activeTurnIndex = index;
	}

	function captureScrollSnapshot(): ScrollSnapshot | null {
		const target = scrollTarget();
		if (target === window) {
			const top = window.scrollY;
			return { mode: 'window', top, stickToBottom: Math.max(0, document.documentElement.scrollHeight - window.innerHeight) - top < 80 };
		}
		const element = target as HTMLElement;
		const top = element.scrollTop;
		return { mode: 'element', top, stickToBottom: Math.max(0, element.scrollHeight - element.clientHeight) - top < 80 };
	}

	function restoreScrollSnapshot(snapshot: ScrollSnapshot | null) {
		if (!snapshot || !mainScroller) return;
		scrollRestoreLockUntil = Date.now() + 300;
		if (snapshot.mode === 'window') {
			window.scrollTo({ top: snapshot.stickToBottom ? document.documentElement.scrollHeight : snapshot.top, behavior: 'auto' });
			return;
		}
		const target = scrollTarget();
		if (target !== window) {
			const element = target as HTMLElement;
			element.scrollTo({ top: snapshot.stickToBottom ? element.scrollHeight : snapshot.top, behavior: 'auto' });
		}
	}

	function isNearBottom(): boolean {
		const target = scrollTarget();
		if (target === window) {
			return Math.max(0, document.documentElement.scrollHeight - window.innerHeight) - window.scrollY < 96;
		}
		const element = target as HTMLElement;
		return Math.max(0, element.scrollHeight - element.clientHeight) - element.scrollTop < 96;
	}

	function jumpTurn(dir: 'previous' | 'next') {
		const n = getHistoricalTurnElements().length;
		if (!n) return;
		scrollTurnIntoView(dir === 'previous' ? Math.max(0, activeTurnIndex - 1) : Math.min(n - 1, activeTurnIndex + 1));
	}

	function maybeFollowLiveOutput(threadId: string) {
		if (threadId !== selectedThreadId || !followLiveOutput) return;
		void tick().then(() => { if (followLiveOutput) scrollMainTo('bottom', 'auto'); });
	}

	function handleEvent(event: ConsoleEvent) {
		if (event.type === 'thread.started') { void loadThreads(); return; }
		if (event.type === 'approval.requested') {
			if (event.threadId === selectedThreadId) approvals = [...approvals.filter(a => a.requestId !== event.approval.requestId), event.approval];
			return;
		}
		if (event.type === 'approval.resolved') { approvals = approvals.filter(a => a.requestId !== event.requestId); return; }
		if (event.type === 'turn.completed') {
			void loadThreads();
			if (event.threadId === selectedThreadId) { runningTurnId = null; void loadThread(event.threadId, { silent: true }); }
			return;
		}
		if (event.type === 'turn.started') { if (event.threadId === selectedThreadId) runningTurnId = event.turnId; return; }
		if (event.type === 'item.started' || event.type === 'item.completed') { updateLiveEntry(event.item.id, event.threadId, event.item); maybeFollowLiveOutput(event.threadId); return; }
		if (event.type === 'message.delta') { const c = liveEntries[event.itemId]; updateLiveEntry(event.itemId, event.threadId, { text: `${c?.text ?? ''}${event.delta}` }, { kind: 'assistant', label: 'Assistant' }); maybeFollowLiveOutput(event.threadId); return; }
		if (event.type === 'reasoning.delta') { const c = liveEntries[event.itemId]; updateLiveEntry(event.itemId, event.threadId, { text: `${c?.text ?? ''}${event.delta}` }, { kind: 'reasoning', label: 'Reasoning' }); maybeFollowLiveOutput(event.threadId); return; }
		if (event.type === 'command.delta') { const c = liveEntries[event.itemId]; updateLiveEntry(event.itemId, event.threadId, { output: `${c?.output ?? ''}${event.delta}` }, { kind: 'command', label: 'Command' }); maybeFollowLiveOutput(event.threadId); return; }
		if (event.type === 'file_change.delta') { const c = liveEntries[event.itemId]; updateLiveEntry(event.itemId, event.threadId, { text: `${c?.text ?? ''}${event.delta}` }, { kind: 'file_change', label: 'File change' }); maybeFollowLiveOutput(event.threadId); return; }
		if (event.type === 'error') errorMessage = event.message;
	}

	// ── Effects ──
	$effect(() => {
		source?.close();
		source = null;
		if (!authenticated) return;
		const next = new EventSource('/api/events');
		liveConnectionState = source ? 'reconnecting' : 'connecting';
		next.onopen = () => { liveConnectionState = 'live'; };
		next.onmessage = (raw) => { handleEvent(JSON.parse(raw.data) as ConsoleEvent); };
		next.onerror = () => { liveConnectionState = 'reconnecting'; };
		source = next;
		return () => { next.close(); if (source === next) source = null; };
	});

	$effect(() => {
		if (authenticated && selectedThreadId && selectedThread?.thread.id !== selectedThreadId) void loadThread(selectedThreadId);
	});

	$effect(() => {
		if (!authenticated || loadingThread || draftingThread) return;
		const id = selectedThread?.thread.id ?? data.selectedThread?.thread.id ?? null;
		if (!id || id === autoScrolledThreadId) return;
		autoScrolledThreadId = id;
		void tick().then(() => scrollMainTo('bottom'));
	});

	$effect(() => {
		if (!authenticated || !mainScroller || showingDraftThread) return;
		const target = scrollTarget();
		const handle = () => {
			if (Date.now() < scrollRestoreLockUntil) return;
			followLiveOutput = isNearBottom();
			if (historicalTurns.length > 0) syncActiveTurnIndex();
		};
		void tick().then(() => handle());
		target.addEventListener('scroll', handle, { passive: true });
		window.addEventListener('resize', handle);
		return () => { target.removeEventListener('scroll', handle); window.removeEventListener('resize', handle); };
	});

	$effect(() => {
		if (!authenticated) return;
		if (!allThreads.length) {
			selectedThreadId = null;
			selectedThread = null;
			approvals = [];
			liveEntries = {};
			draftingThread = true;
			return;
		}
		if (selectedThreadId && !allThreads.some(t => t.id === selectedThreadId)) {
			selectedThreadId = null;
			selectedThread = null;
			approvals = [];
			liveEntries = {};
			draftingThread = true;
		}
	});
</script>

{#if !authenticated}
	<LoginView
		tokenConfigured={data.tokenConfigured}
		fallbackTokenActive={data.fallbackTokenActive}
		loginError={form?.loginError}
	/>
{:else}
	<div class:sidebar-collapsed={sidebarCollapsed} class="app-shell">
		<!-- Sidebar -->
		<aside class="sidebar">
			<div class="sidebar-header">
				<div>
					<h1>Codex</h1>
					<small>Web Console</small>
				</div>
				<div class="sidebar-actions">
					<button onclick={cycleTheme} title="Toggle theme" aria-label="Toggle theme">
						<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
							{#if currentTheme === 'dark'}
								<path d="M17 12.7A7 7 0 1 1 7.3 3a7 7 0 0 0 9.7 9.7z" />
							{:else}
								<circle cx="10" cy="10" r="4" />
								<path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M3.4 3.4l1.4 1.4M15.2 15.2l1.4 1.4M15.2 4.8l1.4-1.4M3.4 16.6l1.4-1.4" />
							{/if}
						</svg>
					</button>
					<button
						onclick={() => { sidebarCollapsed = true; }}
						aria-label="Collapse sidebar" title="Collapse sidebar"
					>
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<path d="M7 4v12M13 7l-3 3 3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</button>
				</div>
			</div>

			<button style="width:100%;justify-content:center" onclick={startDraftThread}>
				New thread
			</button>

			<select bind:value={providerFilter} style="font-size:12px">
				{#each providerOptions as provider}
					<option value={provider}>{provider === 'all' ? 'All providers' : provider}</option>
				{/each}
			</select>

			<ThreadList
				threads={visibleThreads}
				selectedThreadId={draftingThread ? null : visibleSelectedThreadId}
				onSelect={(id) => void openThread(id)}
			/>

			<div class="status-bar">
				<span class="live-dot {liveConnectionState}" style="flex:0 0 auto"></span>
				<span style="flex:1">{liveConnectionState === 'live' ? 'Connected' : liveConnectionState === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>
			</div>
		</aside>

		<main bind:this={mainScroller} class="main">
			<div class="thread-workspace">
				<!-- Header -->
				<div class="detail-header">
					<div>
						<h2 class="detail-title">
							{showingDraftThread ? 'New thread' : (selectedSummary?.title ?? 'Nothing selected')}
						</h2>
						{#if !showingDraftThread && selectedSummary}
							<p class="detail-cwd">{selectedSummary.cwd}</p>
						{/if}
					</div>
					{#if showingDraftThread}
						<button class="ghost" onclick={() => void openBrowser(workspacePath || visibleWorkspacePath)}>
							Browse
						</button>
					{/if}
				</div>

				<!-- Body -->
				{#if showingDraftThread}
					<div class="compose-view">
						<div class="compose-panel">
							{#if liveConnectionWarning}
								<p class="warning live-warning">{liveConnectionWarning}</p>
							{/if}
							{#if visibleErrorMessage}
								<p class="error">{visibleErrorMessage}</p>
							{/if}
							<div>
								<span class="compose-field-label">Workspace</span>
								<input bind:value={workspacePath} spellcheck="false" />
							</div>
							<div>
								<span class="compose-field-label">Message</span>
								<textarea
									bind:value={newPrompt}
									rows="6"
									onkeydown={(e) => submitOnEnter(e, () => void createThread())}
								></textarea>
							</div>
							<button onclick={() => void createThread()} disabled={submitting}>
								{submitting ? 'Starting…' : 'Start thread'}
							</button>
						</div>
					</div>
				{:else if loadingThread}
					<div class="detail-body">
						<p class="empty">Loading thread…</p>
					</div>
				{:else}
					<div class="detail-body">
						<div class="detail-body-inner">
							<Timeline
								turns={visibleSelectedThread?.turns ?? []}
								liveEntries={liveEntryList}
								preservedEntries={runtimeReasoningList}
								{approvals}
							/>
						</div>
					</div>

					<!-- Approvals -->
					{#if approvals.length > 0}
						<div class="approval-actions">
							{#each approvals as approval (approval.requestId)}
								<div class="approval-buttons">
									<button onclick={() => void resolveApproval(approval.requestId, 'accept')}>
										Allow once
									</button>
									<button class="ghost" onclick={() => void resolveApproval(approval.requestId, 'acceptForSession')}>
										Allow session
									</button>
									<button class="danger" onclick={() => void resolveApproval(approval.requestId, 'decline')}>
										Decline
									</button>
								</div>
							{/each}
						</div>
					{/if}
				{/if}

				<!-- Reply -->
				{#if !showingDraftThread && visibleSelectedThread}
					<div class="reply-box">
						{#if liveConnectionWarning}
							<p class="warning live-warning">{liveConnectionWarning}</p>
						{/if}
						{#if visibleErrorMessage}
							<p class="error">{visibleErrorMessage}</p>
						{/if}
						<textarea
							bind:value={replyPrompt}
							rows="3"
							placeholder="Type a message…"
							disabled={Boolean(interruptableTurnId) || interrupting}
							onkeydown={(e) => submitOnEnter(e, () => void sendReply())}
						></textarea>
						<div class="reply-actions">
							<button
								onclick={() => void sendReply()}
								disabled={submitting || interrupting || Boolean(interruptableTurnId)}
							>
								{submitting ? 'Sending…' : 'Send'}
							</button>
							{#if interruptableTurnId}
								<button class="danger" onclick={() => void interruptCurrentTurn()} disabled={interrupting}>
									{interrupting ? 'Stopping…' : 'Stop'}
								</button>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</main>
	</div>

	{#if sidebarCollapsed}
		<button
			type="button"
			class="sidebar-reopen"
			onclick={() => { sidebarCollapsed = false; }}
			aria-label="Expand sidebar" title="Expand sidebar"
		>
			<svg viewBox="0 0 20 20" aria-hidden="true">
				<path d="M7 4v12M10 7l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</button>
	{/if}

	{#if !browserOpen}
		<div class="screen-tools" role="group" aria-label="Page controls">
			<button type="button" class="floating-button" aria-label="Scroll to top" title="Scroll to top" onclick={() => scrollMainTo('top')}>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path d="M5 8.75 10 4l5 4.75M5 13.75 10 9l5 4.75" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
			{#if !showingDraftThread}
				<button type="button" class="floating-button" aria-label="Previous turn" title="Previous turn" disabled={!hasHistoricalTurns || activeTurnIndex <= 0} onclick={() => jumpTurn('previous')}>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path d="M12.5 6 7.5 10l5 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>
				<button type="button" class="floating-button" aria-label="Next turn" title="Next turn" disabled={!hasHistoricalTurns || activeTurnIndex >= historicalTurns.length - 1} onclick={() => jumpTurn('next')}>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path d="M7.5 6 12.5 10l-5 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>
			{/if}
			<button type="button" class="floating-button" aria-label="Scroll to bottom" title="Scroll to bottom" onclick={() => scrollMainTo('bottom')}>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path d="M5 6.25 10 11l5-4.75M5 11.25 10 16l5-4.75" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
			<form method="POST" action="?/logout" use:enhance={enhanceRedirect} class="logout-form" style="margin:0;line-height:0">
				<button class="floating-button" aria-label="Log out" title="Log out">
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path d="M8 3.5H5.75A2.25 2.25 0 0 0 3.5 5.75v8.5A2.25 2.25 0 0 0 5.75 16.5H8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
						<path d="M11 6.25 15 10l-4 3.75M15 10H7.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</button>
			</form>
		</div>
	{/if}

	<WorkspaceBrowser
		open={browserOpen}
		{listing}
		selectedPath={workspacePath}
		onClose={() => { browserOpen = false; }}
		onNavigate={(p) => void openBrowser(p)}
		onSelect={(p) => { workspacePath = p; browserOpen = false; }}
	/>
{/if}
