<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		tokenConfigured,
		fallbackTokenActive,
		loginError
	}: {
		tokenConfigured: boolean;
		fallbackTokenActive: boolean;
		loginError?: string;
	} = $props();

	const enhanceRedirect: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true });
				return;
			}
			await update();
		};
	};
</script>

<section class="login-shell">
	<div class="login-card">
		<h1>Codex Web Console</h1>
		<p>Enter your access token to continue.</p>

		{#if !tokenConfigured}
			<p class="warning">
				Set <code>CODEX_WEB_CONSOLE_TOKEN</code> before logging in.
			</p>
		{:else if fallbackTokenActive}
			<p class="warning">Dev fallback token is active.</p>
		{/if}

		<form method="POST" action="?/login" class="login-form" use:enhance={enhanceRedirect}>
			<input
				name="token"
				type="password"
				autocomplete="off"
				spellcheck="false"
				placeholder="Paste token"
			/>
			<button type="submit">Continue</button>
		</form>

		{#if loginError}
			<p class="error">{loginError}</p>
		{/if}
	</div>
</section>
