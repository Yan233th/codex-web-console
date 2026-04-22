<script lang="ts">
	import { renderMarkdown } from '$lib/render-markdown';
	import type { ApprovalRequest, TimelineEntry, TimelineTurn } from '$lib/types';

	let {
		turns,
		liveEntries,
		preservedEntries = [],
		approvals
	}: {
		turns: TimelineTurn[];
		liveEntries: TimelineEntry[];
		preservedEntries?: TimelineEntry[];
		approvals: ApprovalRequest[];
	} = $props();

	function renderEntry(entry: TimelineEntry) {
		if (entry.kind === 'command') {
			return 'command';
		}

		if (entry.kind === 'reasoning') {
			return 'reasoning';
		}

		if (entry.kind === 'web_search') {
			return 'web_search';
		}

		return 'default';
	}
</script>

<section class="timeline">
	{#if turns.length === 0 && liveEntries.length === 0 && preservedEntries.length === 0}
		<p class="empty">Start a thread to see activity.</p>
	{/if}

	{#each turns as turn (turn.id)}
		<section class="turn" id={`turn-${turn.id}`} data-turn-id={turn.id}>
			<div class="turn-meta">
				<span>Turn</span>
				<strong>{turn.status}</strong>
			</div>

			{#each turn.entries as entry (entry.id)}
				<article class={`entry entry-${entry.kind}`}>
					<header>{entry.label}</header>

					{#if renderEntry(entry) === 'command'}
						<details class="command-block">
							<summary>
								<span class="command-summary-label" title={entry.command || 'Command'}>
									{entry.command || 'Command'}
								</span>
								{#if entry.exitCode !== null && entry.exitCode !== undefined}
									<small>exit {entry.exitCode}</small>
								{/if}
							</summary>

							{#if entry.cwd}
								<pre class="command-code">{entry.cwd}{entry.command ? `\n$ ${entry.command}` : ''}</pre>
							{:else if entry.command}
								<pre class="command-code">$ {entry.command}</pre>
							{/if}

							{#if entry.output}
								<pre class="command-code command-output">{entry.output}</pre>
							{/if}
						</details>
					{:else if renderEntry(entry) === 'reasoning'}
						<details class="info-block" open>
							<summary>{entry.text || 'Reasoning'}</summary>
							{#if entry.text}
								<div class="markdown" data-kind={entry.kind}>
									{@html renderMarkdown(entry.text)}
								</div>
							{/if}
						</details>
					{:else if renderEntry(entry) === 'web_search'}
						<details class="info-block">
							<summary>{entry.query || 'Web search'}</summary>
							<div class="search-meta">
								{#if entry.actionType}
									<p class="meta-line">Action: {entry.actionType}</p>
								{/if}
								{#if entry.url}
									<p class="meta-line">{entry.url}</p>
								{/if}
								{#if entry.pattern}
									<p class="meta-line">Pattern: {entry.pattern}</p>
								{/if}
								{#if entry.queries && entry.queries.length > 0}
									<ul class="search-queries">
										{#each entry.queries as query}
											<li>{query}</li>
										{/each}
									</ul>
								{/if}
							</div>
						</details>
					{:else}
						{#if entry.text}
							<div class="markdown" data-kind={entry.kind}>
								{@html renderMarkdown(entry.text)}
							</div>
						{/if}
					{/if}

					{#if entry.changes}
						<ul class="changes">
							{#each entry.changes as change}
								<li>{change.kind} {change.path}</li>
							{/each}
						</ul>
					{/if}
				</article>
			{/each}
		</section>
	{/each}

	{#if liveEntries.length > 0}
		<section class="turn turn-live">
			<div class="turn-meta">
				<span>Live</span>
				<strong>running</strong>
			</div>

			{#each liveEntries as entry (entry.id)}
				<article class={`entry entry-${entry.kind}`}>
					<header>{entry.label}</header>

					{#if renderEntry(entry) === 'command'}
						<details class="command-block">
							<summary>
								<span class="command-summary-label" title={entry.command || 'Command'}>
									{entry.command || 'Command'}
								</span>
							</summary>
							{#if entry.cwd}
								<pre class="command-code">{entry.cwd}{entry.command ? `\n$ ${entry.command}` : ''}</pre>
							{:else if entry.command}
								<pre class="command-code">$ {entry.command}</pre>
							{/if}
							{#if entry.output}
								<pre class="command-code command-output">{entry.output}</pre>
							{/if}
						</details>
					{:else if renderEntry(entry) === 'reasoning'}
						<details class="info-block" open>
							<summary>{entry.text || 'Reasoning'}</summary>
							{#if entry.text}
								<div class="markdown" data-kind={entry.kind}>
									{@html renderMarkdown(entry.text)}
								</div>
							{/if}
						</details>
					{:else if renderEntry(entry) === 'web_search'}
						<details class="info-block">
							<summary>{entry.query || 'Web search'}</summary>
							<div class="search-meta">
								{#if entry.actionType}
									<p class="meta-line">Action: {entry.actionType}</p>
								{/if}
								{#if entry.url}
									<p class="meta-line">{entry.url}</p>
								{/if}
								{#if entry.pattern}
									<p class="meta-line">Pattern: {entry.pattern}</p>
								{/if}
								{#if entry.queries && entry.queries.length > 0}
									<ul class="search-queries">
										{#each entry.queries as query}
											<li>{query}</li>
										{/each}
									</ul>
								{/if}
							</div>
						</details>
					{:else if entry.text}
						<div class="markdown" data-kind={entry.kind}>
							{@html renderMarkdown(entry.text)}
						</div>
					{/if}
				</article>
			{/each}
		</section>
	{/if}

	{#if preservedEntries.length > 0}
		<section class="turn turn-preserved">
			<div class="turn-meta">
				<span>Reasoning</span>
				<strong>session</strong>
			</div>

			{#each preservedEntries as entry (entry.id)}
				<article class={`entry entry-${entry.kind}`}>
					<header>{entry.label}</header>
					<details class="info-block" open>
						<summary>{entry.text || 'Reasoning'}</summary>
						{#if entry.text}
							<div class="markdown" data-kind={entry.kind}>
								{@html renderMarkdown(entry.text)}
							</div>
						{/if}
					</details>
				</article>
			{/each}
		</section>
	{/if}

	{#if approvals.length > 0}
		<section class="approval-stack">
			{#each approvals as approval (approval.requestId)}
				<article class="approval-card">
					<p class="eyebrow">Approval</p>
					<h3>{approval.title}</h3>
					{#if approval.reason}
						<p>{approval.reason}</p>
					{/if}
					{#if approval.command}
						<pre>{approval.command}</pre>
					{/if}
				</article>
			{/each}
		</section>
	{/if}
</section>
