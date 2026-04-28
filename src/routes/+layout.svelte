<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	let { children } = $props();

	// Restore saved theme from localStorage on load
	$effect(() => {
		const saved = localStorage.getItem('theme') as 'dark' | 'light' | null;
		const root = document.documentElement;
		root.classList.remove('light', 'dark');
		root.classList.add(saved === 'light' ? 'light' : 'dark');
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#1c1c1e" media="(prefers-color-scheme: dark)" />
	<meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)" />
</svelte:head>

{@render children()}
