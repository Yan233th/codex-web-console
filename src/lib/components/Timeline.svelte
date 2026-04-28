<script lang="ts">
	import { renderMarkdown } from '$lib/render-markdown';
	import type { ApprovalRequest, TimelineEntry, TimelineTurn } from '$lib/types';

	let {
		turns,
		liveEntries,
		preservedEntries = [],
		approvals,
		omittedTurnCount = 0,
		onLoadFullHistory
	}: {
		turns: TimelineTurn[];
		liveEntries: TimelineEntry[];
		preservedEntries?: TimelineEntry[];
		approvals: ApprovalRequest[];
		omittedTurnCount?: number;
		onLoadFullHistory?: () => void;
	} = $props();

	const BATCH = 5;
	let visibleCount = $state(BATCH);
	const visibleTurns = $derived(turns.slice(Math.max(0, turns.length - visibleCount)));
	const remaining = $derived(Math.max(0, turns.length - visibleCount));
	const hidden = $derived(Math.max(0, remaining));
	const liveIsRunning = $derived(liveEntries.some(isActiveCommand));
	let now = $state(Date.now());

	type ChangeStats = {
		path: string;
		kind: string;
		additions: number;
		deletions: number;
		diff: string;
	};

	type ChangeSummary = {
		files: ChangeStats[];
		additions: number;
		deletions: number;
	};

	function loadMore() {
		visibleCount = Math.min(turns.length, visibleCount + BATCH);
	}

	function isFoldableWork(entry: TimelineEntry) {
		if (entry.kind === 'assistant' && entry.phase === 'commentary') return true;
		return (
			entry.kind === 'reasoning' ||
			entry.kind === 'command' ||
			entry.kind === 'tool_call' ||
			entry.kind === 'file_change' ||
			entry.kind === 'web_search' ||
			entry.kind === 'plan'
		);
	}

	function isInlineFoldableWork(entry: TimelineEntry) {
		return (
			entry.kind === 'reasoning' ||
			entry.kind === 'command' ||
			entry.kind === 'tool_call' ||
			entry.kind === 'file_change' ||
			entry.kind === 'web_search' ||
			entry.kind === 'plan'
		);
	}

	function isFinalAnswer(entry: TimelineEntry) {
		return entry.kind === 'assistant' && entry.phase === 'final_answer';
	}

	function isActiveCommand(entry: TimelineEntry) {
		if (entry.kind !== 'command') return false;
		if (entry.completedAt) return false;
		const status = entry.status?.toLowerCase() ?? '';
		if (
			status.includes('completed') ||
			status.includes('finished') ||
			status.includes('failed') ||
			status.includes('cancel') ||
			status.includes('interrupt') ||
			status.includes('error')
		) return false;
		if (
			status.includes('running') ||
			status.includes('started') ||
			status.includes('active') ||
			status.includes('pending') ||
			status.includes('progress') ||
			status.includes('executing')
		) return true;
		return entry.exitCode === null && Boolean(entry.command || entry.output);
	}

	const hasActiveTimers = $derived.by(() => {
		if (approvals.length > 0) return true;
		if (liveEntries.some(isActiveCommand)) return true;
		return visibleTurns.some((turn) => (
			turn.completedAt === null ||
			turn.entries.some(isActiveCommand)
		));
	});

	$effect(() => {
		if (!hasActiveTimers) return;
		now = Date.now();
		const timer = window.setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => window.clearInterval(timer);
	});

	function formatDuration(durationMs: number | null | undefined) {
		if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs)) return '';

		const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
		if (minutes > 0) return `${minutes}m ${seconds}s`;
		return `${seconds}s`;
	}

	function elapsedMs(entry: TimelineEntry) {
		if (entry.durationMs !== null && entry.durationMs !== undefined) return entry.durationMs;
		if (!entry.startedAt) return null;
		const end = entry.completedAt ?? (isActiveCommand(entry) ? now : null);
		return end ? Math.max(0, end - entry.startedAt) : null;
	}

	function commandStatusLabel(entry: TimelineEntry) {
		const parts: string[] = [];
		const duration = formatDuration(elapsedMs(entry));

		if (isActiveCommand(entry)) {
			parts.push('running');
		} else if (entry.status) {
			parts.push(entry.status);
		}

		if (entry.exitCode !== null && entry.exitCode !== undefined) {
			parts.push(`exit ${entry.exitCode}`);
		}

		if (duration) parts.push(duration);
		return parts.join(' · ');
	}

	function summarizeWork(entries: TimelineEntry[]) {
		const commandCount = entries.filter((entry) => entry.kind === 'command').length;
		const toolCallCount = entries.filter((entry) => entry.kind === 'tool_call').length;
		const fileChangeCount = entries.filter((entry) => entry.kind === 'file_change').length;
		const webSearchCount = entries.filter((entry) => entry.kind === 'web_search').length;
		const parts: string[] = [];

		if (commandCount > 0) parts.push(`Ran ${commandCount} command${commandCount > 1 ? 's' : ''}`);
		if (toolCallCount > 0) parts.push(`调用 ${toolCallCount} 个工具`);
		if (fileChangeCount > 0) parts.push(`已编辑 ${fileChangeCount} 个文件`);
		if (webSearchCount > 0) parts.push(`搜索 ${webSearchCount} 次`);

		return parts.join(' · ');
	}

	function summarizeInlineWork(entries: TimelineEntry[]) {
		const activeCommand = entries.find(isActiveCommand);
		if (activeCommand) return '正在运行命令';

		const summary = summarizeWork(entries);
		if (summary) return summary;

		if (entries.some((entry) => entry.kind === 'reasoning')) return '思考过程';
		if (entries.some((entry) => entry.kind === 'plan')) return '更新计划';
		return '处理细节';
	}

	function inlineDuration(entries: TimelineEntry[]) {
		const timedEntry = entries.find(isActiveCommand) ?? entries.find((entry) => Boolean(entry.startedAt));
		return timedEntry ? formatDuration(elapsedMs(timedEntry)) : '';
	}

	function buildInlineBatches(entries: TimelineEntry[]) {
		const batches: Array<{ index: number; entries: TimelineEntry[]; summary: string; duration: string }> = [];
		let current: { index: number; entries: TimelineEntry[] } | null = null;

		for (const [index, entry] of entries.entries()) {
			if (isInlineFoldableWork(entry)) {
				current ??= { index, entries: [] };
				current.entries.push(entry);
				continue;
			}

			if (current) {
				batches.push({
					...current,
					summary: summarizeInlineWork(current.entries),
					duration: inlineDuration(current.entries)
				});
				current = null;
			}
		}

		if (current) {
			batches.push({
				...current,
				summary: summarizeInlineWork(current.entries),
				duration: inlineDuration(current.entries)
			});
		}

		return batches;
	}

	function batchAt(
		batches: Array<{ index: number; entries: TimelineEntry[]; summary: string; duration: string }>,
		index: number
	) {
		return batches.find((batch) => batch.index === index) ?? null;
	}

	function diffStats(diff: string) {
		let additions = 0;
		let deletions = 0;

		for (const line of diff.split(/\r?\n/)) {
			if (line.startsWith('+++') || line.startsWith('---')) continue;
			if (line.startsWith('+')) additions += 1;
			if (line.startsWith('-')) deletions += 1;
		}

		return { additions, deletions };
	}

	function fileName(filePath: string) {
		return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
	}

	function buildChangeSummary(entries: TimelineEntry[]): ChangeSummary | null {
		const files = new Map<string, ChangeStats>();

		for (const entry of entries) {
			if (entry.kind !== 'file_change' || !entry.changes) continue;

			for (const change of entry.changes) {
				if (!change.path) continue;

				const stats = diffStats(change.diff);
				const current = files.get(change.path);
				if (current) {
					current.kind = change.kind || current.kind;
					current.additions += stats.additions;
					current.deletions += stats.deletions;
					current.diff = [current.diff, change.diff].filter(Boolean).join('\n\n');
					continue;
				}

				files.set(change.path, {
					path: change.path,
					kind: change.kind,
					additions: stats.additions,
					deletions: stats.deletions,
					diff: change.diff
				});
			}
		}

		const fileList = [...files.values()];
		if (fileList.length === 0) return null;

		return {
			files: fileList,
			additions: fileList.reduce((total, file) => total + file.additions, 0),
			deletions: fileList.reduce((total, file) => total + file.deletions, 0)
		};
	}

	// Codex-style folding: keep user/final messages visible, fold reasoning and tools into a turn-level row.
	function analyseTurn(entries: TimelineEntry[]) {
		const hasFinalAnswer = entries.some(isFinalAnswer);

		if (!hasFinalAnswer) {
			const batches = buildInlineBatches(entries);

			return {
				mode: 'inline' as const,
				collapsed: batches.length > 0,
				firstWorkIndex: -1,
				workEntries: [] as TimelineEntry[],
				workSummary: '',
				batches
			};
		}

		const workEntries = entries.filter(isFoldableWork);
		const firstWorkIndex = entries.findIndex(isFoldableWork);

		return {
			mode: 'turn' as const,
			collapsed: workEntries.length > 0,
			firstWorkIndex,
			workEntries,
			workSummary: summarizeWork(workEntries),
			batches: [] as Array<{ index: number; entries: TimelineEntry[]; summary: string; duration: string }>
		};
	}
</script>

{#snippet renderEntry(entry: TimelineEntry)}
	{@const kind = entry.kind}
	<article class="entry" class:entry-user={kind === 'user'}>
		<span class="entry-label">{entry.label}</span>

		{#if kind === 'command'}
			<details class="command-block" open={isActiveCommand(entry)}>
				<summary>
					<span>{entry.command || 'Command'}</span>
					{#if commandStatusLabel(entry)}
						<small class="command-meta">{commandStatusLabel(entry)}</small>
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
		{:else if kind === 'tool_call'}
			<details class="command-block">
				<summary>
					<span>{entry.serverName ? `${entry.serverName}.${entry.toolName ?? 'tool'}` : (entry.toolName ?? 'Tool call')}</span>
					{#if commandStatusLabel(entry)}
						<small class="command-meta">{commandStatusLabel(entry)}</small>
					{/if}
				</summary>
				{#if entry.toolInput}
					<pre class="command-code">{entry.toolInput}</pre>
				{/if}
				{#if entry.toolOutput}
					<pre class="command-code command-output">{entry.toolOutput}</pre>
				{/if}
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
{/snippet}

{#snippet renderWorkCollapse(workEntries: TimelineEntry[], statusLabel: string, durationLabel = '', workSummary = '')}
	<details class="work-collapse" open={workEntries.some(isActiveCommand)}>
		<summary class="work-summary">
			<span class="work-summary-main">
				<span>{statusLabel}</span>
				{#if durationLabel}
					<span>{durationLabel}</span>
				{/if}
				<span class="work-chevron" aria-hidden="true">›</span>
			</span>
			<span class="work-summary-rule"></span>
		</summary>

		<div class="work-detail">
			{#if workSummary}
				<p class="work-summary-text">{workSummary}</p>
			{/if}
			{#each workEntries as entry (entry.id)}
				{@render renderEntry(entry)}
			{/each}
		</div>
	</details>
{/snippet}

{#snippet renderChangeSummary(summary: ChangeSummary)}
	<section class="file-change-summary" aria-label="文件变更摘要">
		<div class="file-change-header">
			<div class="file-change-title">
				<strong>{summary.files.length} 个文件已更改</strong>
				<span class="diff-add">+{summary.additions}</span>
				<span class="diff-del">-{summary.deletions}</span>
			</div>
		</div>

		<div class="changed-file-list">
			{#each summary.files as file (file.path)}
				<details class="changed-file">
					<summary>
						<span class="changed-file-name" title={file.path}>{fileName(file.path)}</span>
						<span class="changed-file-stats">
							<span class="diff-add">+{file.additions}</span>
							<span class="diff-del">-{file.deletions}</span>
						</span>
						<span class="changed-file-dot" title={file.kind}></span>
						<span class="changed-file-chevron" aria-hidden="true">⌄</span>
					</summary>
					{#if file.diff}
						<pre class="changed-file-diff">{file.diff}</pre>
					{/if}
				</details>
			{/each}
		</div>
	</section>
{/snippet}

<section class="timeline">
	{#if omittedTurnCount > 0 && onLoadFullHistory}
		<div class="load-more-strip">
			<button type="button" class="ghost load-more-btn" onclick={onLoadFullHistory}>
				Load full history — <span class="load-more-count">{omittedTurnCount}+ earlier turn{omittedTurnCount > 1 ? 's' : ''}</span>
			</button>
		</div>
	{/if}

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
		{@const analysis = analyseTurn(turn.entries)}
		{@const changeSummary = buildChangeSummary(turn.entries)}
		<section class="turn" id={`turn-${turn.id}`} data-turn-id={turn.id}>
			<div class="turn-meta">
				<span class="dot"></span>
				<span>Turn</span>
				<span>{turn.status}</span>
			</div>

			{#if analysis.mode === 'turn' && analysis.collapsed}
				{#each turn.entries as entry, index (entry.id)}
					{#if index === analysis.firstWorkIndex}
						{@render renderWorkCollapse(
							analysis.workEntries,
							turn.completedAt === null ? '处理中' : '已处理',
							formatDuration(turn.durationMs),
							analysis.workSummary
						)}
					{/if}

					{#if !isFoldableWork(entry)}
						{@render renderEntry(entry)}
					{/if}
				{/each}
			{:else if analysis.mode === 'inline' && analysis.collapsed}
				{#each turn.entries as entry, index (entry.id)}
					{@const batch = batchAt(analysis.batches, index)}
					{#if batch}
						{@render renderWorkCollapse(batch.entries, batch.summary, batch.duration, '')}
					{/if}

					{#if !isInlineFoldableWork(entry)}
						{@render renderEntry(entry)}
					{/if}
				{/each}
			{:else}
				{#each turn.entries as entry (entry.id)}
					{@render renderEntry(entry)}
				{/each}
			{/if}

			{#if turn.completedAt !== null && changeSummary}
				{@render renderChangeSummary(changeSummary)}
			{/if}
		</section>
	{/each}

	{#if liveEntries.length > 0}
		<section class="turn">
			<div class="turn-meta">
				<span class="dot" style:background={liveIsRunning ? 'var(--success)' : 'var(--ink-faint)'}></span>
				<span class:running={liveIsRunning}>Live</span>
				<span>{liveIsRunning ? 'running' : 'settled'}</span>
			</div>

			{#each liveEntries as entry (entry.id)}
				{@render renderEntry(entry)}
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
					<h3>
						<span>{approval.title}</span>
						<span class="approval-wait">等待允许 {formatDuration(now - approval.requestedAt)}</span>
					</h3>
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
