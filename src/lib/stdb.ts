import { PUBLIC_SPACETIMEDB_URI, PUBLIC_SPACETIMEDB_DB } from '$app/env/public';
import { DbConnection } from '#lib/module_bindings/index.ts';

const TOKEN_KEY = `stdb_token:${PUBLIC_SPACETIMEDB_DB}`;

function readToken(): string | undefined {
	try {
		return localStorage.getItem(TOKEN_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

/** Connection builder for Maincloud; the token keeps the same identity across reloads. */
export function connectionBuilder() {
	return DbConnection.builder()
		.withUri(PUBLIC_SPACETIMEDB_URI)
		.withDatabaseName(PUBLIC_SPACETIMEDB_DB)
		.withToken(readToken())
		.onConnect((_conn, _identity, token) => {
			try {
				localStorage.setItem(TOKEN_KEY, token);
			} catch {
				/* storage unavailable */
			}
		})
		.onConnectError((_ctx, err) => console.error('SpacetimeDB connect error', err));
}
