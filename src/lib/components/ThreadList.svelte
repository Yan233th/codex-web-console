<script lang="ts">
	import type { ThreadSummary } from '$lib/types';

	type ThreadGroup = {
		key: string;
		name: string;
		path: string;
		count: number;
		updatedAt: number | null;
		threads: ThreadSummary[];
	};

	let {
		threads,
		selectedThreadId,
		onSelect
	}: {
		threads: ThreadSummary[];
		selectedThreadId: string | null;
		onSelect: (threadId: string) => void;
	} = $props();

	let collapsedWorkspaceKeys = $state<string[]>([]);

	const threadGroups = $derived.by(() => groupThreadsByWorkspace(threads));

	function normalizeWorkspacePath(cwd: string): string {
		return cwd.trim().replace(/[\\/]+$/, '') || 'Unknown workspace';
	}

	function workspaceKey(cwd: string): string {
		return normalizeWorkspacePath(cwd).replace(/\\/g, '/');
	}

	function workspaceName(cwd: string): string {
		const normalized = normalizeWorkspacePath(cwd);
		const parts = normalized.split(/[\\/]+/).filter(Boolean);
		return parts.at(-1) ?? normalized;
	}

	function groupThreadsByWorkspace(items: ThreadSummary[]): ThreadGroup[] {
		const groups = new Map<string, ThreadGroup>();

		for (const thread of items) {
			const path = normalizeWorkspacePath(thread.cwd);
			const key = workspaceKey(path);
			let group = groups.get(key);

			if (!group) {
				group = {
					key,
					name: workspaceName(path),
					path,
					count: 0,
					updatedAt: null,
					threads: []
				};
				groups.set(key, group);
			}

			group.threads.push(thread);
			group.count += 1;
			if (thread.updatedAt && (!group.updatedAt || thread.updatedAt > group.updatedAt)) {
				group.updatedAt = thread.updatedAt;
			}
		}

		return [...groups.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
	}

	function formatRelativeTime(timestamp: number | null): string {
		if (!timestamp || !Number.isFinite(timestamp)) return 'unknown';
		const delta = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
		if (delta < 60) return 'just now';
		const m = Math.floor(delta / 60);
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		const d = Math.floor(h / 24);
		if (d < 7) return `${d}d ago`;
		return new Date(timestamp).toLocaleDateString();
	}

	function statusClass(status: string): string {
		if (status === 'active' || status.startsWith('active')) return 'active';
		if (status === 'systemError') return 'error';
		return '';
	}

	function groupHasSelectedThread(group: ThreadGroup): boolean {
		return group.threads.some((thread) => thread.id === selectedThreadId);
	}

	function isGroupCollapsed(group: ThreadGroup): boolean {
		return !groupHasSelectedThread(group) && collapsedWorkspaceKeys.includes(group.key);
	}

	function toggleGroup(group: ThreadGroup) {
		if (groupHasSelectedThread(group)) return;

		if (collapsedWorkspaceKeys.includes(group.key)) {
			collapsedWorkspaceKeys = collapsedWorkspaceKeys.filter((key) => key !== group.key);
		} else {
			collapsedWorkspaceKeys = [...collapsedWorkspaceKeys, group.key];
		}
	}
</script>

<section class="thread-list">
	<div class="thread-items">
		{#if threads.length === 0}
			<p class="empty">No threads yet.</p>
		{:else}
			{#each threadGroups as group, index (group.key)}
				<div class="workspace-group">
					<button
						type="button"
						class:collapsed={isGroupCollapsed(group)}
						class="workspace-group-header"
						aria-expanded={!isGroupCollapsed(group)}
						aria-controls={`workspace-thread-list-${index}`}
						onclick={() => toggleGroup(group)}
					>
						<div class="workspace-group-title">
							<svg class="workspace-chevron" viewBox="0 0 16 16" aria-hidden="true">
								<path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
							<span class="workspace-name">{group.name}</span>
							<span class="workspace-count">{group.count}</span>
						</div>
						<span class="workspace-path" title={group.path}>{group.path}</span>
					</button>
					{#if !isGroupCollapsed(group)}
						<div class="workspace-thread-list" id={`workspace-thread-list-${index}`}>
							{#each group.threads as thread (thread.id)}
								<button
									type="button"
									class:selected={thread.id === selectedThreadId}
									class="thread-item"
									onclick={() => onSelect(thread.id)}
								>
									<span class="thread-title">{thread.title}</span>
									<span class="thread-preview">{thread.preview || thread.cwd}</span>
									<div class="thread-meta">
										<span class="status {statusClass(thread.status)}">
											<span class="status-dot"></span>
											{thread.status === 'idle' ? 'idle' : thread.status}
										</span>
										<span>{formatRelativeTime(thread.updatedAt)}</span>
									</div>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</section>
