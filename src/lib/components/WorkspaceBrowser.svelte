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
	<div class="browser-panel" role="dialog" aria-modal="true" aria-labelledby="workspace-browser-title" tabindex="-1">
		<div class="browser-header">
			<div>
				<h2 id="workspace-browser-title">Select workspace</h2>
				<p title={listing?.path ?? selectedPath}>{listing?.path ?? selectedPath}</p>
			</div>
			<button class="ghost browser-close" onclick={onClose}>Close</button>
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
						<span class="browser-entry-icon" aria-hidden="true">
							<svg viewBox="0 0 20 20">
								<path d="M3.5 6.25A2.25 2.25 0 0 1 5.75 4h2.1c.55 0 .9.2 1.25.62l.8.96c.22.27.42.37.78.37h3.57a2.25 2.25 0 0 1 2.25 2.25v5.05a2.25 2.25 0 0 1-2.25 2.25h-8.5a2.25 2.25 0 0 1-2.25-2.25v-7Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
							</svg>
						</span>
						<span class="browser-entry-copy">
							<strong>{entry.name}</strong>
							<small>{entry.path}</small>
						</span>
					</button>
				{/each}
			{/if}
		</div>
	</div>
{/if}
