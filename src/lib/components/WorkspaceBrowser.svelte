<script lang="ts">
	import type { DirectoryListing } from '$lib/types';

	let {
		open,
		listing,
		selectedPath,
		onClose,
		onNavigate,
		onSelect
	}: {
		open: boolean;
		listing: DirectoryListing | null;
		selectedPath: string;
		onClose: () => void;
		onNavigate: (path: string) => void;
		onSelect: (path: string) => void;
	} = $props();
</script>

{#if open}
	<button type="button" class="browser-backdrop" onclick={onClose} aria-label="Close workspace browser"></button>
	<section class="browser-panel">
		<div class="browser-header">
			<div>
				<p class="eyebrow">Workspace</p>
				<h2>{listing?.path ?? selectedPath}</h2>
			</div>
			<button type="button" class="ghost" onclick={onClose}>Close</button>
		</div>

		<div class="browser-actions">
			{#if listing?.parentPath}
				<button type="button" class="ghost" onclick={() => onNavigate(listing.parentPath!)}>
					Go up
				</button>
			{/if}
			<button type="button" onclick={() => onSelect(listing?.path ?? selectedPath)}>Use this directory</button>
		</div>

		<div class="browser-list">
			{#if listing}
				{#each listing.entries as entry (entry.path)}
					<button type="button" class="browser-entry" onclick={() => onNavigate(entry.path)}>
						<strong>{entry.name}</strong>
						<span>{entry.path}</span>
					</button>
				{/each}
			{/if}
		</div>
	</section>
{/if}
