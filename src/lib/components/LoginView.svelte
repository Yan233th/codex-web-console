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

<section class="login-card">
	<p class="eyebrow">Codex Web Console</p>
	<h1>Enter access token</h1>
	<p class="copy">No user system. One token. One doorway.</p>

	{#if !tokenConfigured}
		<p class="warning">
			Set <code>CODEX_WEB_CONSOLE_TOKEN</code> before logging in.
		</p>
	{:else if fallbackTokenActive}
		<p class="warning">Dev fallback token is active.</p>
	{/if}

	<form method="POST" action="?/login" class="login-form" use:enhance={enhanceRedirect}>
		<label class="field">
			<span>Token</span>
			<input
				name="token"
				type="password"
				autocomplete="off"
				spellcheck="false"
				placeholder="Paste token"
			/>
		</label>

		<button type="submit">Continue</button>
	</form>

	{#if loginError}
		<p class="error">{loginError}</p>
	{/if}
</section>
