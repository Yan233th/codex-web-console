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

	const BATCH = 5;
	let visibleCount = $state(BATCH);
	const visibleTurns = $derived(turns.slice(Math.max(0, turns.length - visibleCount)));
	const remaining = $derived(Math.max(0, turns.length - visibleCount));
	const hidden = $derived(Math.max(0, remaining));

	function loadMore() {
		visibleCount = Math.min(turns.length, visibleCount + BATCH);
	}
</script>

<section class="timeline">
	{#if hidden > 0}
		<div class="load-more-strip">
			<button type="button" class="ghost load-more-btn" onclick={loadMore}>
				Load more history — <span class="load-more-count">{hidden > BATCH ? `${hidden}+` : hidden} turn{hidden > 1 ? 's' : ''}</span>
			</button>
		</div>
	{/if}

	{#if visibleTurns.length === 0 && liveEntries.length === 0 && preservedEntries.length === 0}
		<p class="empty">Start a thread to see activity.</p>
	{/if}

	{#each visibleTurns as turn (turn.id)}
		<section class="turn" id={`turn-${turn.id}`} data-turn-id={turn.id}>
			<div class="turn-meta">
				<span class="dot"></span>
				<span>Turn</span>
				<span>{turn.status}</span>
			</div>

			{#each turn.entries as entry (entry.id)}
				{@const kind = entry.kind}
				<article class="entry">
					<span class="entry-label">{entry.label}</span>

					{#if kind === 'command'}
						<details class="command-block">
							<summary>
								<span>{entry.command || 'Command'}</span>
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
					{:else if kind === 'reasoning'}
						<details class="command-block" open>
							<summary><span>{entry.label}</span></summary>
							{#if entry.text}
								<div class="markdown">{@html renderMarkdown(entry.text)}</div>
							{/if}
						</details>
					{:else if kind === 'web_search'}
						<details class="command-block">
							<summary><span>{entry.query || 'Web search'}</span></summary>
							<div class="entry-text">
								{#if entry.actionType}
									<p style="font-size:12px;color:var(--ink-soft)">Action: {entry.actionType}</p>
								{/if}
								{#if entry.url}
									<p style="font-size:12px;color:var(--ink-soft)">{entry.url}</p>
								{/if}
								{#if entry.queries && entry.queries.length > 0}
									<ul style="font-size:12px;color:var(--ink-soft)">
										{#each entry.queries as q}
											<li>{q}</li>
										{/each}
									</ul>
								{/if}
							</div>
						</details>
					{:else}
						{#if entry.text}
							<div class="markdown">{@html renderMarkdown(entry.text)}</div>
						{/if}
					{/if}

					{#if entry.changes}
						<ul style="font-size:12px;color:var(--ink-soft);margin:0;padding-left:16px">
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
		<section class="turn">
			<div class="turn-meta">
				<span class="dot" style="background:var(--success)"></span>
				<span class="running">Live</span>
				<span>running</span>
			</div>

			{#each liveEntries as entry (entry.id)}
				{@const kind = entry.kind}
				<article class="entry">
					<span class="entry-label">{entry.label}</span>

					{#if kind === 'command'}
						<details class="command-block" open>
							<summary><span>{entry.command || 'Command'}</span></summary>
							{#if entry.cwd}
								<pre class="command-code">{entry.cwd}{entry.command ? `\n$ ${entry.command}` : ''}</pre>
							{:else if entry.command}
								<pre class="command-code">$ {entry.command}</pre>
							{/if}
							{#if entry.output}
								<pre class="command-code command-output">{entry.output}</pre>
							{/if}
						</details>
					{:else if kind === 'reasoning'}
						<details class="command-block" open>
							<summary><span>{entry.label}</span></summary>
							{#if entry.text}
								<div class="markdown">{@html renderMarkdown(entry.text)}</div>
							{/if}
						</details>
					{:else if kind === 'web_search'}
						<details class="command-block" open>
							<summary><span>{entry.query || 'Web search'}</span></summary>
							<div class="entry-text">
								{#if entry.url}
									<p style="font-size:12px;color:var(--ink-soft)">{entry.url}</p>
								{/if}
								{#if entry.queries && entry.queries.length > 0}
									<ul style="font-size:12px;color:var(--ink-soft)">
										{#each entry.queries as q}
											<li>{q}</li>
										{/each}
									</ul>
								{/if}
							</div>
						</details>
					{:else if entry.text}
						<div class="markdown">{@html renderMarkdown(entry.text)}</div>
					{/if}
				</article>
			{/each}
		</section>
	{/if}

	{#if preservedEntries.length > 0}
		<section class="turn">
			<div class="turn-meta">
				<span class="dot"></span>
				<span>Reasoning</span>
				<span>session</span>
			</div>
			{#each preservedEntries as entry (entry.id)}
				<article class="entry">
					<span class="entry-label">{entry.label}</span>
					<details class="command-block" open>
						<summary><span>Reasoning</span></summary>
						{#if entry.text}
							<div class="markdown">{@html renderMarkdown(entry.text)}</div>
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
