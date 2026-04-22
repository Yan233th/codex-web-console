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

	function formatRelativeTime(timestamp: number): string {
		const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

		if (deltaSeconds < 60) {
			return 'just now';
		}

		const minutes = Math.floor(deltaSeconds / 60);
		if (minutes < 60) {
			return `${minutes}m ago`;
		}

		const hours = Math.floor(minutes / 60);
		if (hours < 24) {
			return `${hours}h ago`;
		}

		const days = Math.floor(hours / 24);
		if (days < 7) {
			return `${days}d ago`;
		}

		return new Date(timestamp).toLocaleDateString();
	}
</script>

<section class="thread-list">
	<div class="sidebar-header">
		<p class="eyebrow">Threads</p>
		<p class="sidebar-copy">{threads.length} loaded</p>
	</div>

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
					<strong class="thread-title">{thread.title}</strong>
					<span class="thread-cwd">{thread.cwd}</span>
					{#if thread.provider}
						<small class="thread-provider">{thread.provider}</small>
					{/if}
					<div class="thread-meta">
						<small class="thread-status">{thread.status}</small>
						<small class="thread-updated">{formatRelativeTime(thread.updatedAt)}</small>
					</div>
				</button>
			{/each}
		{/if}
	</div>
</section>
