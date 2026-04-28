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
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="browser-backdrop" onclick={onClose}></div>
	<section class="browser-panel">
		<div class="browser-header">
			<h2 title={listing?.path ?? selectedPath}>{listing?.path ?? selectedPath}</h2>
			<button class="ghost" onclick={onClose}>Close</button>
		</div>

		<div class="browser-actions">
			{#if listing?.parentPath}
				<button class="ghost" onclick={() => onNavigate(listing.parentPath!)}>Go up</button>
			{/if}
			<button onclick={() => onSelect(listing?.path ?? selectedPath)}>Use this</button>
		</div>

		<div class="browser-list">
			{#if listing}
				{#each listing.entries as entry (entry.path)}
					<button class="browser-entry" onclick={() => onNavigate(entry.path)}>
						<strong>{entry.name}</strong>
						<small>{entry.path}</small>
					</button>
				{/each}
			{/if}
		</div>
	</section>
{/if}
