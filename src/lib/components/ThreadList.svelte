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
					<small class="thread-status">{thread.status}</small>
				</button>
			{/each}
		{/if}
	</div>
</section>
