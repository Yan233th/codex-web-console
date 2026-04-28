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
		PermissionMode,
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
	let liveEntryBuffers = $state<Record<string, Record<string, TimelineEntry>>>({});
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
	let showScrollToBottom = $state(false);
	let liveConnectionState = $state<'connecting' | 'live' | 'reconnecting'>('connecting');
	let permissionMode = $state<PermissionMode>('default');
	let permissionMenuOpen = $state(false);

	const permissionOptions: Array<{
		mode: PermissionMode;
		label: string;
		description: string;
	}> = [
		{
			mode: 'default',
			label: '默认权限',
			description: '需要时请求许可'
		},
		{
			mode: 'auto',
			label: '自动审查',
			description: '由 Codex 自动审查许可'
		},
		{
			mode: 'full',
			label: '完全访问权限',
			description: '无沙箱，自动允许'
		}
	];
	// ── Derived ──
	const selectedPermission = $derived(
		permissionOptions.find((option) => option.mode === permissionMode) ?? permissionOptions[0]
	);
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
	const visibleLiveEntryList = $derived.by(() =>
		filterHistoricalLiveEntries(Object.values(liveEntries), visibleSelectedThread)
	);
	const visiblePreservedEntryList = $derived.by(() =>
		filterHistoricalLiveEntries(runtimeReasoningList, visibleSelectedThread)
	);
	let runningTurnId = $state<string | null>(null);
	const historicalRunningTurnId = $derived.by(() => findActiveTurnId(visibleSelectedThread));
	const liveRunningTurnId = $derived.by(() => {
		if (!runningTurnId) return null;
		const detail = visibleSelectedThread;
		if (!detail) return runningTurnId;

		const matchingTurn = detail.turns.find((turn) => turn.id === runningTurnId);
		if (matchingTurn) return isActiveTurn(matchingTurn) ? runningTurnId : null;

		return isActiveThreadStatus(detail.thread.status) ? runningTurnId : null;
	});
	const interruptableTurnId = $derived(historicalRunningTurnId ?? liveRunningTurnId);

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

	$effect(() => {
		const saved =
			typeof localStorage !== 'undefined'
				? (localStorage.getItem('permissionMode') as PermissionMode | null)
				: null;
		if (saved === 'default' || saved === 'auto' || saved === 'full') {
			permissionMode = saved;
		}
	});

	function selectPermissionMode(mode: PermissionMode) {
		permissionMode = mode;
		permissionMenuOpen = false;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('permissionMode', mode);
		}
	}

	function isMobileViewport() {
		return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
	}

	function collapseSidebarOnMobile() {
		if (isMobileViewport()) sidebarCollapsed = true;
	}

	$effect(() => {
		if (!authenticated || typeof window === 'undefined') return;

		const query = window.matchMedia('(max-width: 768px)');
		if (query.matches) sidebarCollapsed = true;

		const handleChange = (event: MediaQueryListEvent) => {
			if (event.matches) sidebarCollapsed = true;
		};

		query.addEventListener('change', handleChange);
		return () => query.removeEventListener('change', handleChange);
	});

	function threadHref(threadId: string | null): string {
		if (!threadId) return '/';
		return `/?${new URLSearchParams({ thread: threadId }).toString()}`;
	}

	function isThreadNotFound(error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return /thread not found/i.test(message);
	}

	function clearSelectedThreadState(message?: string) {
		selectedThreadId = null;
		selectedThread = null;
		runningTurnId = null;
		liveEntries = {};
		approvals = [];
		draftingThread = true;
		replyPrompt = '';
		if (message) errorMessage = message;
	}

	function removeLiveBuffer(threadId: string) {
		const { [threadId]: _removed, ...rest } = liveEntryBuffers;
		liveEntryBuffers = rest;
	}

	function flushLiveBuffer(threadId: string) {
		const buffered = liveEntryBuffers[threadId];
		if (!buffered) return;
		liveEntries = { ...buffered, ...liveEntries };
		removeLiveBuffer(threadId);
	}

	function stashCurrentLiveEntries() {
		if (!selectedThreadId || Object.keys(liveEntries).length === 0) return;
		liveEntryBuffers = {
			...liveEntryBuffers,
			[selectedThreadId]: {
				...(liveEntryBuffers[selectedThreadId] ?? {}),
				...liveEntries
			}
		};
		liveEntries = {};
	}

	function getLiveEntry(threadId: string, itemId: string) {
		return threadId === selectedThreadId ? liveEntries[itemId] : liveEntryBuffers[threadId]?.[itemId];
	}

	function isTerminalStatus(status: string | null | undefined) {
		const value = status?.toLowerCase() ?? '';
		return (
			value.includes('completed') ||
			value.includes('finished') ||
			value.includes('failed') ||
			value.includes('cancel') ||
			value.includes('interrupt') ||
			value.includes('error')
		);
	}

	function isActiveThreadStatus(status: string | null | undefined) {
		const value = status?.toLowerCase() ?? '';
		return (
			value.includes('active') ||
			value.includes('running') ||
			value.includes('executing') ||
			value.includes('pending') ||
			value.includes('started')
		);
	}

	function isActiveTurn(turn: ThreadDetail['turns'][number]) {
		return turn.completedAt === null && !isTerminalStatus(turn.status);
	}

	function findActiveTurnId(detail: ThreadDetail | null) {
		const turns = detail?.turns ?? [];
		for (let i = turns.length - 1; i >= 0; i--) {
			if (isActiveTurn(turns[i])) return turns[i].id;
		}
		return null;
	}

	function settledHistoricalTurnIds(detail: ThreadDetail) {
		return new Set(
			detail.turns
				.filter((turn) => !isActiveTurn(turn))
				.map((turn) => turn.id)
		);
	}

	function isRuntimeOnlyEntry(entry: TimelineEntry) {
		return entry.kind === 'reasoning';
	}

	function isHistoricalLiveEntry(
		entry: TimelineEntry,
		historicalIds: Set<string>,
		settledTurnIds: Set<string>
	) {
		if (historicalIds.has(entry.id)) return true;
		return Boolean(!isRuntimeOnlyEntry(entry) && entry.turnId && settledTurnIds.has(entry.turnId));
	}

	function filterHistoricalLiveEntries(entries: TimelineEntry[], detail: ThreadDetail | null) {
		if (!detail) return entries;
		const historicalIds = new Set(detail.turns.flatMap((turn) => turn.entries.map((entry) => entry.id)));
		const settledTurnIds = settledHistoricalTurnIds(detail);
		return entries.filter((entry) => !isHistoricalLiveEntry(entry, historicalIds, settledTurnIds));
	}

	function reconcileRunningTurn(detail: ThreadDetail) {
		const activeTurnId = findActiveTurnId(detail);
		if (activeTurnId) {
			runningTurnId = runningTurnId ?? activeTurnId;
			return;
		}

		const matchingTurn = runningTurnId
			? detail.turns.find((turn) => turn.id === runningTurnId)
			: null;
		if (!isActiveThreadStatus(detail.thread.status) || (matchingTurn && !isActiveTurn(matchingTurn))) {
			runningTurnId = null;
		}
	}

	function mergeEntry(base: TimelineEntry, patch: Partial<TimelineEntry>): TimelineEntry {
		const startedAt =
			base.startedAt && patch.startedAt
				? Math.min(base.startedAt, patch.startedAt)
				: (base.startedAt ?? patch.startedAt ?? Date.now());
		const status =
			isTerminalStatus(base.status) && !isTerminalStatus(patch.status)
				? base.status
				: (patch.status ?? base.status);
		return {
			...base,
			...patch,
			status,
			startedAt,
			completedAt: patch.completedAt ?? base.completedAt ?? null,
			text:
				(base.kind === 'reasoning' || patch.kind === 'reasoning') && base.text && !patch.text
					? base.text
					: (patch.text ?? base.text ?? ''),
			output:
				patch.output && patch.output.length > 0
					? patch.output
					: (base.output ?? patch.output ?? '')
		};
	}

	function pruneLiveEntriesFromDetail(detail: ThreadDetail) {
		const historicalIds = new Set(detail.turns.flatMap((turn) => turn.entries.map((entry) => entry.id)));
		const settledTurnIds = settledHistoricalTurnIds(detail);
		const keepEntry = ([itemId, entry]: [string, TimelineEntry]) =>
			!historicalIds.has(itemId) &&
			!(!isRuntimeOnlyEntry(entry) && entry.turnId && settledTurnIds.has(entry.turnId));

		if (detail.thread.id === selectedThreadId) {
			liveEntries = Object.fromEntries(Object.entries(liveEntries).filter(keepEntry));
		}

		const buffered = liveEntryBuffers[detail.thread.id];
		if (buffered) {
			liveEntryBuffers = {
				...liveEntryBuffers,
				[detail.thread.id]: Object.fromEntries(Object.entries(buffered).filter(keepEntry))
			};
		}

		const preserved = runtimeReasoning[detail.thread.id];
		if (preserved) {
			runtimeReasoning = {
				...runtimeReasoning,
				[detail.thread.id]: preserved.filter(
					(entry) => !isHistoricalLiveEntry(entry, historicalIds, settledTurnIds)
				)
			};
		}
	}

	async function openThread(threadId: string | null) {
		collapseSidebarOnMobile();
		if (!threadId) {
			stashCurrentLiveEntries();
			selectedThreadId = null;
			selectedThread = null;
			runningTurnId = null;
			draftingThread = true;
			followLiveOutput = true;
			errorMessage = null;
			liveEntries = {};
			approvals = [];
			replyPrompt = '';
			await goto(threadHref(null), { keepFocus: true, noScroll: true });
			return;
		}
		if (selectedThreadId !== threadId) {
			stashCurrentLiveEntries();
			liveEntries = {};
			runningTurnId = null;
		}
		draftingThread = false;
		selectedThreadId = threadId;
		flushLiveBuffer(threadId);
		followLiveOutput = true;
		errorMessage = null;
		await goto(threadHref(threadId), { keepFocus: true, noScroll: true });
	}

	function updateLiveEntry(itemId: string, threadId: string, patch: Partial<TimelineEntry>, defaults?: Pick<TimelineEntry, 'kind' | 'label'>) {
		const selected = threadId === selectedThreadId;
		const entries = selected ? liveEntries : (liveEntryBuffers[threadId] ?? {});
		const current = entries[itemId];
		const base = current ?? (defaults ? { id: itemId, ...defaults, text: '', output: '', startedAt: Date.now() } : { id: itemId, kind: 'system' as const, label: 'System', text: '', output: '', startedAt: Date.now() });
		const next = { ...entries, [itemId]: mergeEntry(base, patch) };

		if (selected) {
			liveEntries = next;
		} else {
			liveEntryBuffers = { ...liveEntryBuffers, [threadId]: next };
		}
	}

	function completeLiveEntriesForTurn(threadId: string, turnId: string) {
		const entries = threadId === selectedThreadId ? liveEntries : (liveEntryBuffers[threadId] ?? {});
		let changed = false;
		const completedAt = Date.now();
		const next = Object.fromEntries(
			Object.entries(entries).map(([itemId, entry]) => {
				if (entry.turnId !== turnId || entry.completedAt) return [itemId, entry];
				changed = true;
				return [
					itemId,
					mergeEntry(entry, {
						status: entry.kind === 'command' ? 'completed' : entry.status,
						completedAt,
						durationMs: entry.startedAt ? completedAt - entry.startedAt : entry.durationMs
					})
				];
			})
		);
		if (!changed) return;
		if (threadId === selectedThreadId) {
			liveEntries = next;
		} else {
			liveEntryBuffers = { ...liveEntryBuffers, [threadId]: next };
		}
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
			reconcileRunningTurn(payload.detail);
			approvals = payload.detail.approvals;
			pruneLiveEntriesFromDetail(payload.detail);
			if (silent) {
				await tick();
				restoreScrollSnapshot(snapshot);
				await new Promise<void>(r => requestAnimationFrame(() => { restoreScrollSnapshot(snapshot); r(); }));
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (isThreadNotFound(error)) {
				clearSelectedThreadState(message);
				await goto(threadHref(null), { keepFocus: true, noScroll: true });
			} else {
				errorMessage = message;
			}
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
			const payload = await readJson<{ thread: ThreadSummary }>(await fetch('/api/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: workspacePath, prompt: newPrompt, permissionMode }) }));
			bootErrorMessage = null;
			newPrompt = '';
			draftingThread = false;
			await loadThreads();
			await openThread(payload.thread.id);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (isThreadNotFound(error)) clearSelectedThreadState(message);
			else errorMessage = message;
		}
		finally { submitting = false; }
	}

	async function sendReply() {
		if (!selectedThread || !replyPrompt.trim()) return;
		if (interruptableTurnId) { errorMessage = 'This turn is still running. Stop it before sending another reply.'; return; }
		submitting = true;
		followLiveOutput = true;
		errorMessage = null;
		try {
			await readJson<{ ok: true }>(await fetch(`/api/threads/${selectedThread.thread.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cwd: selectedThread.thread.cwd, prompt: replyPrompt, permissionMode }) }));
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
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (isThreadNotFound(error)) clearSelectedThreadState(message);
			else errorMessage = message;
		}
		finally { interrupting = false; }
	}

	function startDraftThread() {
		collapseSidebarOnMobile();
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

	function syncScrollState() {
		const nearBottom = isNearBottom();
		followLiveOutput = nearBottom;
		showScrollToBottom = !nearBottom;
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
			completeLiveEntriesForTurn(event.threadId, event.turnId);
			if (runningTurnId === event.turnId) runningTurnId = null;
			if (event.threadId === selectedThreadId) { void loadThread(event.threadId, { silent: true }); }
			return;
		}
		if (event.type === 'turn.started') { if (event.threadId === selectedThreadId) runningTurnId = event.turnId; return; }
		if (event.type === 'item.started') {
			updateLiveEntry(event.item.id, event.threadId, {
				...event.item,
				turnId: event.turnId,
				startedAt: event.item.startedAt ?? Date.now()
			});
			maybeFollowLiveOutput(event.threadId);
			return;
		}
		if (event.type === 'item.completed') {
			const current = getLiveEntry(event.threadId, event.item.id);
			const completedAt = event.item.completedAt ?? Date.now();
			const startedAt = event.item.startedAt ?? current?.startedAt ?? null;
			updateLiveEntry(event.item.id, event.threadId, {
				...event.item,
				turnId: event.turnId,
				startedAt,
				completedAt,
				durationMs: event.item.durationMs ?? (startedAt ? completedAt - startedAt : null)
			});
			maybeFollowLiveOutput(event.threadId);
			return;
		}
		if (event.type === 'message.delta') { const c = getLiveEntry(event.threadId, event.itemId); updateLiveEntry(event.itemId, event.threadId, { turnId: event.turnId, text: `${c?.text ?? ''}${event.delta}` }, { kind: 'assistant', label: 'Assistant' }); maybeFollowLiveOutput(event.threadId); return; }
		if (event.type === 'reasoning.delta') { const c = getLiveEntry(event.threadId, event.itemId); updateLiveEntry(event.itemId, event.threadId, { turnId: event.turnId, text: `${c?.text ?? ''}${event.delta}` }, { kind: 'reasoning', label: 'Reasoning' }); maybeFollowLiveOutput(event.threadId); return; }
		if (event.type === 'command.delta') { const c = getLiveEntry(event.threadId, event.itemId); updateLiveEntry(event.itemId, event.threadId, { ...event.item, turnId: event.turnId, output: `${c?.output ?? ''}${event.delta}` }, { kind: 'command', label: 'Command' }); maybeFollowLiveOutput(event.threadId); return; }
		if (event.type === 'file_change.delta') { const c = getLiveEntry(event.threadId, event.itemId); updateLiveEntry(event.itemId, event.threadId, { turnId: event.turnId, text: `${c?.text ?? ''}${event.delta}` }, { kind: 'file_change', label: 'File change' }); maybeFollowLiveOutput(event.threadId); return; }
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
		if (selectedThreadId) flushLiveBuffer(selectedThreadId);
	});

	$effect(() => {
		const threadId = selectedThreadId;
		if (!authenticated || !threadId || !interruptableTurnId) return;
		const timer = window.setInterval(() => {
			void loadThread(threadId, { silent: true });
		}, 5000);
		return () => window.clearInterval(timer);
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
			syncScrollState();
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
			liveEntryBuffers = {};
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

{#snippet permissionIcon(mode: PermissionMode)}
	<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
		{#if mode === 'default'}
			<path d="M7.5 10.4V5.8a1.3 1.3 0 0 1 2.6 0v4" />
			<path d="M10.1 9.4V4.8a1.3 1.3 0 0 1 2.6 0v5" />
			<path d="M12.7 9.8V6.2a1.3 1.3 0 0 1 2.6 0v5.4c0 3-1.9 5.4-5 5.4H9.1a5 5 0 0 1-4.2-2.3l-2-3.1a1.25 1.25 0 0 1 2-1.5l1.3 1.4" />
		{:else if mode === 'auto'}
			<path d="M10 2.6 15.7 5v4.5c0 3.3-2.2 6.2-5.7 7.8-3.5-1.6-5.7-4.5-5.7-7.8V5L10 2.6z" />
			<path d="M7.4 10.1 9.1 11.8 12.8 8" />
		{:else}
			<path d="M10 2.6 15.7 5v4.5c0 3.3-2.2 6.2-5.7 7.8-3.5-1.6-5.7-4.5-5.7-7.8V5L10 2.6z" />
			<path d="M10 6.4v4.3" />
			<path d="M10 13.6h.01" />
		{/if}
	</svg>
{/snippet}

{#snippet permissionPicker()}
	<div class="permission-picker">
		<button
			type="button"
			class:full={permissionMode === 'full'}
			class="permission-trigger"
			aria-haspopup="menu"
			aria-expanded={permissionMenuOpen}
			onclick={(event) => { event.stopPropagation(); permissionMenuOpen = !permissionMenuOpen; }}
		>
			<span class="permission-trigger-icon">{@render permissionIcon(selectedPermission.mode)}</span>
			<span>{selectedPermission.label}</span>
			<svg class="permission-chevron" viewBox="0 0 20 20" aria-hidden="true">
				<path d="M6 8 10 12 14 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</button>
		{#if permissionMenuOpen}
			<div class="permission-menu" role="menu" tabindex="-1">
				{#each permissionOptions as option}
					<button
						type="button"
						class:selected={permissionMode === option.mode}
						class:full={option.mode === 'full'}
						class="permission-option"
						role="menuitemradio"
						aria-checked={permissionMode === option.mode}
						onclick={() => selectPermissionMode(option.mode)}
					>
						<span class="permission-option-icon">{@render permissionIcon(option.mode)}</span>
						<span class="permission-option-copy">
							<span>{option.label}</span>
							<small>{option.description}</small>
						</span>
						{#if permissionMode === option.mode}
							<svg class="permission-check" viewBox="0 0 20 20" aria-hidden="true">
								<path d="M4 10.5 8 14 16 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet sendIcon()}
	<svg viewBox="0 0 20 20" aria-hidden="true">
		<path d="M10 16V4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
		<path d="M5.5 8.5 10 4l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
	</svg>
{/snippet}

{#snippet stopIcon()}
	<svg viewBox="0 0 20 20" aria-hidden="true">
		<rect x="6.5" y="6.5" width="7" height="7" rx="1.2" fill="currentColor" />
	</svg>
{/snippet}

<svelte:window
	onclick={() => { permissionMenuOpen = false; }}
	onkeydown={(event) => { if (event.key === 'Escape') permissionMenuOpen = false; }}
/>

{#if !authenticated}
	<LoginView
		tokenConfigured={data.tokenConfigured}
		fallbackTokenActive={data.fallbackTokenActive}
		loginError={form?.loginError}
	/>
{:else}
	<div class:sidebar-collapsed={sidebarCollapsed} class="app-shell">
		{#if !sidebarCollapsed}
			<button
				type="button"
				class="mobile-sidebar-backdrop"
				onclick={() => { sidebarCollapsed = true; }}
				aria-label="Close sidebar"
				title="Close sidebar"
			></button>
		{/if}

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
					<form method="POST" action="?/logout" use:enhance={enhanceRedirect} class="logout-form">
						<button aria-label="Log out" title="Log out">
							<svg viewBox="0 0 20 20" aria-hidden="true">
								<path d="M8 3.5H5.75A2.25 2.25 0 0 0 3.5 5.75v8.5A2.25 2.25 0 0 0 5.75 16.5H8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
								<path d="M11 6.25 15 10l-4 3.75M15 10H7.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
						</button>
					</form>
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
							<div class="prompt-composer">
								<textarea
									class="prompt-input"
									bind:value={newPrompt}
									rows="4"
									placeholder="要求后续变更"
									onkeydown={(e) => submitOnEnter(e, () => void createThread())}
								></textarea>
								<div class="prompt-toolbar">
									<div class="prompt-toolbar-left">
										{@render permissionPicker()}
									</div>
									<button
										class="composer-send"
										type="button"
										onclick={() => void createThread()}
										disabled={submitting || !workspacePath.trim() || !newPrompt.trim()}
										aria-label={submitting ? 'Starting thread' : 'Start thread'}
										title={submitting ? 'Starting thread' : 'Start thread'}
									>
										{@render sendIcon()}
									</button>
								</div>
							</div>
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
								liveEntries={visibleLiveEntryList}
								preservedEntries={visiblePreservedEntryList}
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
						<div class="prompt-composer">
							<textarea
								class="prompt-input"
								bind:value={replyPrompt}
								rows="3"
								placeholder="要求后续变更"
								disabled={Boolean(interruptableTurnId) || interrupting}
								onkeydown={(e) => submitOnEnter(e, () => void sendReply())}
							></textarea>
							<div class="prompt-toolbar">
								<div class="prompt-toolbar-left">
									{@render permissionPicker()}
								</div>
								<div class="prompt-toolbar-right">
									{#if interruptableTurnId}
										<button
											class="composer-send composer-stop"
											type="button"
											onclick={() => void interruptCurrentTurn()}
											disabled={interrupting}
											aria-label={interrupting ? 'Stopping current turn' : 'Stop current turn'}
											title={interrupting ? 'Stopping current turn' : 'Stop current turn'}
										>
											{@render stopIcon()}
										</button>
									{:else}
										<button
											class="composer-send"
											type="button"
											onclick={() => void sendReply()}
											disabled={submitting || interrupting || !replyPrompt.trim()}
											aria-label={submitting ? 'Sending message' : 'Send message'}
											title={submitting ? 'Sending message' : 'Send message'}
										>
											{@render sendIcon()}
										</button>
									{/if}
								</div>
							</div>
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

	{#if !browserOpen && !showingDraftThread && showScrollToBottom}
		<div class="screen-tools" role="group" aria-label="Page controls">
			<button type="button" class="floating-button jump-bottom" aria-label="Scroll to bottom" title="Scroll to bottom" onclick={() => scrollMainTo('bottom')}>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path d="M10 4v12M5.5 11.5 10 16l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
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
