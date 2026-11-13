<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { createSpacetimeDBProvider } from 'spacetimedb/svelte';
	import { connectionBuilder } from '#lib/stdb.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	createSpacetimeDBProvider(connectionBuilder());
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
