<script lang="ts">
	// Card-stack / flow-wave mark. No emoji, no illustration - just the geometry.
	let { size = 28, mono = false }: { size?: number; mono?: boolean } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 32 32"
	fill="none"
	aria-hidden="true"
	focusable="false"
>
	<rect
		x="6"
		y="7"
		width="16"
		height="11"
		rx="2.5"
		fill="none"
		stroke={mono ? 'currentColor' : '#9DBBFB'}
		stroke-width="1.7"
		opacity={mono ? 0.55 : 1}
	/>
	<rect
		x="9.5"
		y="12"
		width="16.5"
		height="11.5"
		rx="2.5"
		fill={mono ? 'currentColor' : '#2F6FED'}
	/>
	<path
		d="M13 17.9c1.4-1.5 2.7-1.5 4.1 0s2.7 1.5 4.1 0"
		stroke={mono ? 'var(--surface-raised)' : '#fff'}
		stroke-width="1.7"
		stroke-linecap="round"
		fill="none"
	/>
</svg>
