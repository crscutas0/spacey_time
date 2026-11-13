<script lang="ts">
	import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/svelte';
	import { tables, reducers } from '#lib/module_bindings/index.ts';

	type Person = {
		id: bigint;
		name: string;
		email: string;
		age: number;
		createdAt: { toDate(): Date };
		updatedAt: { toDate(): Date };
	};

	const conn = useSpacetimeDB();

	// Recently changed rows are highlighted briefly so remote edits are visible.
	let flash = $state<Record<string, true>>({});
	function pulse(id: bigint) {
		const key = id.toString();
		flash[key] = true;
		setTimeout(() => delete flash[key], 1500);
	}

	const [people, ready] = useTable(tables.person, {
		onInsert: (row) => pulse(row.id),
		onUpdate: (_old, row) => pulse(row.id)
	});

	const addPerson = useReducer(reducers.addPerson);
	const updatePerson = useReducer(reducers.updatePerson);
	const deletePerson = useReducer(reducers.deletePerson);

	let search = $state('');
	let error = $state('');

	// Add form
	let name = $state('');
	let email = $state('');
	let age = $state<number | null>(null);
	let saving = $state(false);

	// Inline edit
	let editingId = $state<bigint | null>(null);
	let edit = $state({ name: '', email: '', age: 0 });

	let sorted = $derived(
		[...($people as readonly Person[])]
			.filter((p) => {
				const q = search.trim().toLowerCase();
				return !q || p.name.toLowerCase().includes(q) || p.email.includes(q);
			})
			.sort((a, b) => b.createdAt.toDate().getTime() - a.createdAt.toDate().getTime())
	);

	function message(e: unknown) {
		return e instanceof Error ? e.message : String(e);
	}

	async function submitAdd(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		saving = true;
		try {
			await addPerson({ name, email, age: age ?? 0 });
			name = '';
			email = '';
			age = null;
		} catch (err) {
			error = message(err);
		} finally {
			saving = false;
		}
	}

	function startEdit(p: Person) {
		editingId = p.id;
		edit = { name: p.name, email: p.email, age: p.age };
	}

	async function saveEdit(id: bigint) {
		error = '';
		try {
			await updatePerson({ id, ...edit, age: Number(edit.age) || 0 });
			editingId = null;
		} catch (err) {
			error = message(err);
		}
	}

	async function remove(p: Person) {
		if (!confirm(`Delete ${p.name}?`)) return;
		error = '';
		try {
			await deletePerson({ id: p.id });
		} catch (err) {
			error = message(err);
		}
	}

	const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<svelte:head><title>Persons</title></svelte:head>

<main class="mx-auto max-w-4xl px-4 py-10">
	<header class="mb-8 flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-2xl font-semibold text-slate-900">Persons</h1>
			<p class="text-sm text-slate-500">Changes sync live to everyone viewing this page.</p>
		</div>
		<span
			class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium {$conn.isActive
				? 'border-emerald-200 bg-emerald-50 text-emerald-700'
				: 'border-amber-200 bg-amber-50 text-amber-700'}"
		>
			<span
				class="size-2 rounded-full {$conn.isActive
					? 'animate-pulse bg-emerald-500'
					: 'bg-amber-500'}"
			></span>
			{$conn.isActive ? 'Live' : $conn.connectionError ? 'Connection error' : 'Connecting…'}
		</span>
	</header>

	<form
		onsubmit={submitAdd}
		class="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[2fr_2fr_1fr_auto]"
	>
		<input
			bind:value={name}
			required
			maxlength="100"
			placeholder="Name"
			class="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
		/>
		<input
			bind:value={email}
			type="email"
			placeholder="Email (optional)"
			class="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
		/>
		<input
			bind:value={age}
			type="number"
			min="0"
			max="150"
			placeholder="Age"
			class="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
		/>
		<button
			disabled={saving || !name.trim()}
			class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
		>
			{saving ? 'Adding…' : 'Add person'}
		</button>
	</form>

	{#if error}
		<div
			class="mb-4 flex items-start justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
		>
			<span>{error}</span>
			<button onclick={() => (error = '')} class="ml-4 font-medium">Dismiss</button>
		</div>
	{/if}

	<div class="mb-3 flex items-center justify-between gap-3">
		<input
			bind:value={search}
			placeholder="Search by name or email"
			class="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
		/>
		<span class="text-sm text-slate-500">{$people.length} total</span>
	</div>

	<div class="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
		<table class="w-full text-left text-sm">
			<thead class="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
				<tr>
					<th class="px-4 py-3">Name</th>
					<th class="px-4 py-3">Email</th>
					<th class="px-4 py-3">Age</th>
					<th class="px-4 py-3">Updated</th>
					<th class="px-4 py-3 text-right">Actions</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#if !$ready}
					<tr><td colspan="5" class="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
				{:else if sorted.length === 0}
					<tr>
						<td colspan="5" class="px-4 py-8 text-center text-slate-400">
							{search ? 'No matches.' : 'No persons yet. Add one above.'}
						</td>
					</tr>
				{/if}
				{#each sorted as p (p.id)}
					<tr class="transition-colors duration-700 {flash[p.id.toString()] ? 'bg-indigo-50' : ''}">
						{#if editingId === p.id}
							<td class="px-4 py-2">
								<input
									bind:value={edit.name}
									class="w-full rounded border border-slate-300 px-2 py-1"
								/>
							</td>
							<td class="px-4 py-2">
								<input
									bind:value={edit.email}
									type="email"
									class="w-full rounded border border-slate-300 px-2 py-1"
								/>
							</td>
							<td class="px-4 py-2">
								<input
									bind:value={edit.age}
									type="number"
									min="0"
									max="150"
									class="w-20 rounded border border-slate-300 px-2 py-1"
								/>
							</td>
							<td class="px-4 py-2 text-slate-400">—</td>
							<td class="px-4 py-2 text-right whitespace-nowrap">
								<button
									onclick={() => saveEdit(p.id)}
									class="font-medium text-indigo-600 hover:underline">Save</button
								>
								<button
									onclick={() => (editingId = null)}
									class="ml-3 text-slate-500 hover:underline">Cancel</button
								>
							</td>
						{:else}
							<td class="px-4 py-3 font-medium text-slate-900">{p.name}</td>
							<td class="px-4 py-3 text-slate-600">{p.email || '—'}</td>
							<td class="px-4 py-3 text-slate-600">{p.age}</td>
							<td class="px-4 py-3 text-slate-500">{fmt.format(p.updatedAt.toDate())}</td>
							<td class="px-4 py-3 text-right whitespace-nowrap">
								<button
									onclick={() => startEdit(p)}
									class="font-medium text-indigo-600 hover:underline">Edit</button
								>
								<button onclick={() => remove(p)} class="ml-3 text-red-600 hover:underline"
									>Delete</button
								>
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</main>
