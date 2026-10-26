<script lang="ts">
	import { app } from '#lib/store/app-state.svelte';

	interface Props {
		value: string;
		onchange: (deckId: string) => void;
		id?: string;
		includeAll?: boolean;
		allLabel?: string;
	}
	let { value, onchange, id, includeAll = false, allLabel = 'All decks' }: Props = $props();

	const decks = $derived([...app.data.decks].sort((a, b) => a.name.localeCompare(b.name)));
</script>

<select
	{id}
	class="ff-input"
	{value}
	onchange={(e) => onchange((e.currentTarget as HTMLSelectElement).value)}
>
	{#if includeAll}
		<option value="">{allLabel}</option>
	{/if}
	{#each decks as deck (deck.id)}
		<option value={deck.id}>{deck.name}</option>
	{/each}
</select>
