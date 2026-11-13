import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_SPACETIMEDB_URI: {
		public: true,
		static: true,
		description: 'SpacetimeDB server WebSocket URL, e.g. wss://maincloud.spacetimedb.com'
	},
	PUBLIC_SPACETIMEDB_DB: {
		public: true,
		static: true,
		description: 'SpacetimeDB database name on that server'
	}
});
