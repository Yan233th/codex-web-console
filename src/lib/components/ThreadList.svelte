<script lang="ts">
	import type { ThreadSummary } from '$lib/types';

	let {
		threads,
		selectedThreadId,
		onSelect
	}: {
		threads: ThreadSummary[];
		selectedThreadId: string | null;
		onSelect: (threadId: string) => void;
	} = $props();

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
</script>

<section class="thread-list">
	<div class="thread-items">
		{#if threads.length === 0}
			<p class="empty">No threads yet.</p>
		{:else}
			{#each threads as thread (thread.id)}
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
		{/if}
	</div>
</section>
