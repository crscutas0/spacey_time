# SpacetimeDB Core Concepts

SpacetimeDB is a relational database that is also a server. It lets you upload application logic directly into the database as modules, eliminating the traditional web/game server layer entirely. Rust, C#, and C++ modules compile to WebAssembly, while TypeScript modules run on V8.

---

## Critical Rules

1. **Reducers are transactional.** They do not return data to callers. Use subscriptions to read data.
2. **Reducers must be deterministic.** Do not use filesystem, network, external clocks, or external random sources in reducers. Use the reducer context (`ctx`) for SpacetimeDB-provided timestamp and deterministic random values.
3. **Read data via tables/subscriptions**, not reducer return values. Clients get data through subscribed queries.
4. **Auto-increment IDs are not sequential.** Gaps are normal, do not use for ordering. Use timestamps or explicit sequence columns.
5. **`ctx.sender` is the authenticated principal.** Never trust identity passed as arguments.

---

## Feature Implementation Checklist

1. **Backend:** Define table(s) to store the data
2. **Backend:** Define reducer(s) to mutate the data
3. **Client:** Subscribe to the table(s)
4. **Client:** Call the reducer(s) from UI
5. **Client:** Render the data from the table(s)

---

## Debugging Checklist

1. Is SpacetimeDB server running? (`spacetime start`)
2. Is the module published? (`spacetime publish`)
3. Are client bindings generated? (`spacetime generate`)
4. Check server logs for errors (`spacetime logs <db-name>`)
5. Is the reducer actually being called from the client?

---

## Tables

- **Private tables** (default): Only accessible by reducers and the database owner.
- **Public tables**: Exposed for client read access through subscriptions. Writes still require reducers.

Organize data by access pattern, not by entity:

```
Player          PlayerState         PlayerStats
id         <--  player_id           player_id
name            position_x          total_kills
                position_y          total_deaths
                velocity_x          play_time
```

## Reducers

Reducers are transactional functions that modify database state. They run atomically, cannot interact with the outside world, and do not return data to callers. See the language-specific server skills for syntax.

## Event Tables

Event tables broadcast reducer-specific data to clients. Rows are never stored in the client cache (`count()` returns 0, `iter()` yields nothing); only `onInsert` callbacks fire.

## Subscriptions

Subscriptions replicate database rows to clients in real-time.

1. **Subscribe**: Register SQL queries describing needed data
2. **Receive initial data**: All matching rows are sent immediately
3. **Receive updates**: Real-time updates when subscribed rows change
4. **React to changes**: Use callbacks (`onInsert`, `onDelete`, `onUpdate`)

Best practices:
- Group subscriptions by lifetime
- Subscribe before unsubscribing when updating subscriptions
- Avoid overlapping queries
- Use indexes for efficient queries

## Modules

Modules contain application logic that runs inside the database.

- **Tables**: Define the data schema
- **Reducers**: Define callable functions that modify state
- **Event Tables**: Broadcast reducer-specific data to clients
- **Views**: Read-only functions that expose computed subsets of data to clients
- **Procedures**: (Unstable) Functions that can have side effects (HTTP requests, `ctx.withTx`)

Server-side modules can be written in: Rust, C#, TypeScript, C++

Lifecycle: Write → Compile → Publish (`spacetime publish`) → Hot-swap (republish without disconnecting clients)

## Reusable Modules and Configuration

TypeScript and C# support same-language submodule composition. A namespace has a language accessor and a canonical database name; SQL, CLI calls, and HTTP calls use the canonical name. Changing the canonical namespace drops its tables and their data, so pin it when renaming an accessor. TypeScript supports nested submodules; C# composition requires 2.13+ with .NET 10/C# 14, and nested or repeated C# mounts require 2.14+. See the respective server skills for registration and helper-context rules.

Database environment values are read-only strings, including secrets, supplied at publish time, not process environment variables. Keys are exact and case-sensitive: declare every key module code reads; undeclared reads fail even if a value is stored. Required declarations need values before initialization/migration; optional declarations permit absence. Publishing preserves unspecified values; environment-only publishing changes configuration without replacing the module. Transactional reads share a snapshot. In TypeScript/C#, named submodules cannot declare their own environment or read the root environment through host-dispatched entry points; ordinary helper calls retain the caller's access. C# dependencies registered in `public` instead contribute to the root schema. Do not return or log secrets; private storage does not prevent module code from exposing them.

## Views with Arguments and Module Tests

Views can accept arguments in 2.13+ (Rust, TypeScript, C#), queried as `SELECT * FROM view_name(42)`. Use explicit queries instead of subscribe-all on that connection; subscribe-all skips these views. See server skills for definition restrictions and client skills for query/cache rules.

Rust and TypeScript provide in-memory module unit-test harnesses in 2.12+: run native `cargo test` or Vitest with the module-test plugin. These use the real datastore but do not simulate clients, subscriptions, RLS enforcement, lifecycle events, or timer execution. Test those host behaviors against a running database.

## Inter-Database Communication

Reducers can't make network requests, but a reducer can call a reducer in another database on the same server through an **outbox table** (async IDC). The reducer inserts a row, and after its transaction commits, the row is delivered as a reducer call to the target database exactly once, in order with other calls through the same outbox to the same database. The sending reducer doesn't wait, and the two databases don't commit together: the receiving reducer runs later in its own transaction and can fail. An optional `on_result` reducer in the sending database receives the result, so it can undo or record the work.

Use it to split an application into databases that scale and deploy independently, such as a lobby that sends players to separate game world databases. Only Rust and TypeScript modules can declare outbox tables. See the language-specific server skills for syntax.

## Identity

- **Identity**: A long-lived, globally unique identifier for a user.
- **ConnectionId**: Identifies a specific client connection.
- Always use `ctx.sender` / `ctx.Sender` / `ctx.sender()` for authorization.

SpacetimeDB works with many OIDC providers, including SpacetimeAuth (built-in), Auth0, Clerk, Keycloak, Google, and GitHub.


# SpacetimeDB CLI

Use this skill when the user needs help with the `spacetime` CLI tool - initializing projects, building modules, publishing databases, querying data, managing servers, or troubleshooting CLI issues.

## Quick Reference

### Project Initialization & Development

```bash
# Initialize new project
spacetime init my-project --lang rust|csharp|typescript|cpp
spacetime init my-project --template <template-id>

# Build module
spacetime build                    # release build
spacetime build --debug            # faster iteration, slower runtime

# Dev mode (auto-rebuild, auto-publish, generates bindings)
spacetime dev
spacetime dev --client-lang typescript --module-bindings-path ./client/src/module_bindings

# Generate client bindings
spacetime generate --lang typescript|csharp|rust --out-dir ./bindings --module-path ./server
spacetime generate --lang unrealcpp --uproject-dir ./MyGame --module-path ./server --unreal-module-name MyGame
```

### Client and Module Bindings

`spacetime generate --bindings client` (default) generates bindings for clients connecting to a database. `--bindings module` generates receiver bindings used inside a **sending database module** to call reducers in another **receiving database** through asynchronous IDC. Rust and TypeScript module bindings are supported; C#/C++ module bindings are not implemented yet. `unrealcpp` is client-only; `cpp` is accepted only in module mode.

In `spacetime.json`, each sending database's non-inherited `dependencies` array requires its own `module-path` and dependency `name` plus receiving-module `module-path` or `database`. A `database` reference resolves another target's local source/build settings in the same config; it does not fetch a running database's schema. A direct receiving module source takes precedence. Dependencies do not themselves publish receiving databases or inherit the sending module's build settings. `generate <sending-database>` processes both its regular `generate` entries (client bindings by default) and `dependencies` (module bindings automatically); no `--bindings` flag or second `generate` entry is needed for a dependency. For dependencies, module binding language defaults to the sending module's language and Rust/TypeScript output defaults to `<sending module-path>/src/remote_bindings`. Explicit config `out-dir` is config-relative. A regular `generate` entry can select `"bindings": "module"`, but does not use dependency language or output defaults. The CLI `--bindings` override is allowed only when a single generation entry is selected.

`dev` generates only root dependencies before building the sending module, and watches their source paths. Child targets are available for source lookup, not recursive dependency generation. `--skip-generate` skips receiver/client generation and receiver-only watching; `--skip-publish` does not. See https://spacetimedb.com/docs/cli-reference/spacetime-json#receiver-dependencies for examples.

### C# Build Modes

For new .NET 10 modules, `dotnet build` produces a managed library.
`spacetime build` and `spacetime publish` explicitly select `wasi-wasm` and use
NativeAOT-LLVM; `--native-aot` is not required. The manual WASM equivalent is
`dotnet publish -c Release -r wasi-wasm` from the module directory.
Use `spacetime init --lang csharp --dotnet-version 10 my-project` to select
.NET 10 explicitly.

Do not make the project permanently WASM-only to fix a managed build: keep LLVM
package references and WASM settings conditional on the RID. Let dotnet restore
when changing build modes. Managed builds alone do not enable C# module unit tests.

.NET 8 retains WASM/JIT by default and requires `--native-aot` to select NativeAOT
where supported. The CLI manages `SPACETIMEDB_WASM_AOT` and its legacy alias
`EXPERIMENTAL_WASM_AOT`; users do not need to set either for .NET 10.

### Publishing & Deployment

```bash
# Publish to Maincloud (default)
spacetime publish my-database --yes

# Publish to local server
spacetime publish my-database --server local --yes

# Clear database and republish
spacetime publish my-database --delete-data=always --yes
```

### Database Environment

Module declarations validate string values before initialization/migration. Publishing preserves unspecified stored values. For each declared key, precedence is publishing-process environment → resolved config `env` map → stored database value. Undeclared keys can be staged explicitly in JSON, but module code cannot read them until declared. Keep secrets out of checked-in config; use process variables or ignored local config files.

```bash
# Supply declared values while publishing; use a disposable value for local development
API_KEY='development-only' spacetime publish my-database --server local --yes

# Change only the environment of an existing database (no module build/upload)
API_KEY='development-only' spacetime publish my-database --server local --env-only --yes

# Explicitly remove an optional or undeclared key
spacetime publish my-database --server local --env-only --unset-env LOG_LEVEL --yes

# Inspect stored values (these commands print secrets; authorization is required)
spacetime env list my-database --server local
spacetime env get my-database MODE --server local
```

Before `--unset-env`, remove that key from effective JSON/process inputs. Required values cannot be unset. `--replace-env` replaces the whole store and deletes omitted keys; it cannot be combined with `--unset-env`. `--delete-data` also clears environment values; supply required values again after a reset. `--env-only` requires an existing database and cannot be combined with a reset. An empty string is a value, not deletion. `--env` selects a project configuration environment; it does not assign a database environment variable.

There is no separate `spacetime env set`: updates use validated publishing. For full merge/validation semantics see https://spacetimedb.com/docs/databases/environment-variables.

### Database Interaction

```bash
# SQL queries
spacetime sql my-database "SELECT * FROM users"
spacetime sql my-database --interactive   # REPL mode

# Call reducers (each argument is a separate positional arg)
spacetime call my-database my_reducer '"value"' '123'

# Subscribe to changes
spacetime subscribe my-database "SELECT * FROM users" --num-updates 10

# View logs
spacetime logs my-database -f              # follow logs
spacetime logs my-database -n 100          # up to 100 log lines

# Describe schema
# (without --json, output is human-readable text)
spacetime describe my-database --json
spacetime describe my-database tables --json   # also views, reducers, procedures, routes, env, types
spacetime describe my-database tables users --json
spacetime describe my-database reducers my_reducer --json
```

### Database Management

```bash
# List databases
spacetime list

# Delete database
spacetime delete my-database

# Rename database
spacetime rename <database-identity> --to new-name
```

### Server Management

```bash
# List configured servers
spacetime server list

# Add server
spacetime server add local --url http://localhost:3000 --default
spacetime server add myserver --url https://my-spacetime.example.com

# Set default server
spacetime server set-default local

# Test connectivity
spacetime server ping local

# Start local instance
spacetime start

# Clear local data
spacetime server clear
```

### Authentication

```bash
# Login (opens browser)
spacetime login

# Login with token
spacetime login --token <token>

# Show login status
spacetime login show

# Logout
spacetime logout
```

### SpacetimeAuth Management (2.13+)

`spacetime auth` manages SpacetimeAuth settings; it is not a replacement for `spacetime login`. Log in and enable SpacetimeAuth for the database first. Pass the database **name**, not its identity. For example:

```bash
spacetime auth config set my-database display_name 'My App'
spacetime auth idp enable my-database github
spacetime auth client create my-database --name web
spacetime auth client set my-database --name web web true
spacetime auth client get my-database --name web
spacetime auth client set my-database --name web redirect_uris 'https://example.com/callback'
```

The command families are `config set/reset`, `idp set/enable/disable`, and `client create/delete/get/set`. `idp set <database> <idp> <client_id>` prompts for the OAuth secret when omitted (or reads it from stdin); avoid embedding real secrets in shell history. `client get --include-secret` explicitly prints a client's secret; ordinary create/get output does not. These commands use the SpacetimeAuth management service, not the database `--server` target. Use each subcommand's `--help` for supported providers, settings, and values.

## Default Servers

| Name | URL | Description |
|------|-----|-------------|
| `maincloud` | `https://maincloud.spacetimedb.com` | Production cloud (default) |
| `local` | `http://127.0.0.1:3000` | Local development server |

## Common Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--server` | `-s` | Target server (nickname, hostname, or URL) |
| `--yes` | `-y` | Non-interactive mode (skip confirmations) |
| `--anonymous` | | Use anonymous identity |
| `--module-path` | `-p` | Path to module project |
| `--no-config` | | Ignore `spacetime.json` project configuration |

## Troubleshooting

### "Not logged in"
```bash
spacetime login
# Or use --anonymous for public operations
```

### "Server not responding"
```bash
spacetime server ping <server>
# For local: ensure spacetime start is running
```

### "Schema conflict"
```bash
# Clear data and republish
spacetime publish my-db --delete-data=always --yes
```

### "Build failed"
```bash
# Check Rust/C# toolchain
rustup show
# For Rust modules, ensure wasm32-unknown-unknown target
rustup target add wasm32-unknown-unknown
```

## Module Languages

**Server-side (modules):** Rust, C#, TypeScript, C++
**Client SDKs:** TypeScript, C#, Rust, Unreal Engine
**CLI `generate` targets:** TypeScript, C#, Rust, Unreal C++


# SpacetimeDB TypeScript SDK Reference

## Module Structure

Tables are built with `table()`, bound with `schema()`, and exported as default. Reducers and lifecycle hooks are `export const`:

```typescript
import { schema, table, t } from 'spacetimedb/server';

const scoreRecord = table(
  { name: 'score_record', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity(),
    value: t.u32(),
  }
);

const spacetimedb = schema({ scoreRecord });  // ONE object, not spread args
export default spacetimedb;

export const addRecord = spacetimedb.reducer(
  { value: t.u32() },
  (ctx, { value }) => {
    ctx.db.scoreRecord.insert({ id: 0n, owner: ctx.sender, value });
  }
);
```

`schema({...})` accepts table definitions and submodule namespace registrations. Row and object builders used as reducer arguments or view return types are not schema entries. Environment declarations go in the second argument: `schema(tables, { env: { ... } })`.

Export the default schema and every reducer, lifecycle hook, view, procedure, HTTP export, and visibility filter to register. Root-entry named exports must be registered SpacetimeDB values: keep ordinary root helpers/constants unexported. A submodule library may export ordinary helpers for its consumer to call, because submodule discovery ignores non-module exports; do not re-export those helpers from the root entry.

## Imports

Schema builders and module exports come from `spacetimedb/server`. Runtime value classes such as `ScheduleAt`, `Timestamp`, and `ConnectionId` come from the root `spacetimedb` package; `Range` comes from `spacetimedb/server`:

```typescript
import {
  schema, table, t, SenderError,
  type InferSchema, type ReducerCtx,
} from 'spacetimedb/server';
import { ConnectionId, ScheduleAt, Timestamp } from 'spacetimedb';
import { Range } from 'spacetimedb/server';
```

## Tables

`table(OPTIONS, COLUMNS)` takes two arguments. The `name` field MUST be snake_case:

```typescript
const entity = table(
  { name: 'entity', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    active: t.bool(),
  }
);
```

Options: `name` (snake_case, recommended), `public: true`, `event: true`, `indexes: [...]`

`ctx.db` accessors are the keys passed to `schema({...})`, verbatim: `schema({ scoreRecord })` -> `ctx.db.scoreRecord`. Keep TypeScript identifiers and accessors camelCase. Use explicit `name: 'snake_case'` strings when you need a canonical database name that differs from the TypeScript identifier.

## Column Types

Every column is a `t` builder value:

| Builder | JS type | Notes |
|---------|---------|-------|
| `t.u8()` / `t.u16()` / `t.u32()` | number | |
| `t.i8()` / `t.i16()` / `t.i32()` | number | |
| `t.u64()` | bigint | Use `0n` literals |
| `t.i64()` | bigint | Use `0n` literals |
| `t.u128()` / `t.i128()` / `t.u256()` / `t.i256()` | bigint | |
| `t.f64()` / `t.f32()` | number | |
| `t.bool()` | boolean | |
| `t.string()` | string | |
| `t.identity()` | Identity | |
| `t.connectionId()` | ConnectionId | |
| `t.timestamp()` | Timestamp | |
| `t.timeDuration()` | TimeDuration | |
| `t.scheduleAt()` | ScheduleAt | |

Modifiers: `.primaryKey()`, `.autoInc()`, `.unique()`, `.index('btree')`, `.default(value)`.

Use `.default(value)` only for a newly appended migration-safe field. Do not put defaults on primary-key, unique, or auto-increment columns.

Optional columns: `nickname: t.option(t.string())`

Schema builders describe the database's wire types; they are not TypeScript type names. For example, a `t.u16()` value is a TypeScript `number`, not a value cast to a type named `u16`.

## Indexes

Use inline `.index('btree')` when a single-column index does not need a named accessor. Use an `indexes` entry when the accessor is named explicitly or the index spans multiple columns. Every `indexes` entry requires `columns`; do not also add `.index('btree')` to the same column.

```typescript
// Inline (preferred for single-column):
authorId: t.u64().index('btree'),
// Access: ctx.db.post.authorId.filter(authorId);

// Multi-column (named):
indexes: [{ accessor: 'byGroupUser', algorithm: 'btree', columns: ['groupId', 'userId'] }]
// Access: ctx.db.membership.byGroupUser.filter([groupId, userId]);
```

Prefer a multi-column index over filtering by one column and looping. Filter takes an array in index column order; a prefix scan passes the leading value bare: `filter(groupId)`.

The published module's **entry file must export the schema as default**. If you split tables
(`schema.ts`) from reducers/lifecycle (`index.ts`), re-export it from the entry:

```typescript
// index.ts
export { default } from './schema';   // re-export the schema for the module entry
```

## Reducers

Reducers are created with `spacetimedb.reducer(...)`; the export name becomes the reducer name:

```typescript
export const createEntity = spacetimedb.reducer(
  { name: t.string(), age: t.i32() },
  (ctx, { name, age }) => {
    ctx.db.entity.insert({ identity: ctx.sender, name, age, active: true });
  }
);

// No arguments, just the callback:
export const doReset = spacetimedb.reducer((ctx) => { ... });
```

Reducer args accept any column type, including arrays of custom types: `{ splits: t.array(Split) }`. Do not pass JSON strings for structured data.

## DB Operations

```typescript
ctx.db.scoreRecord.insert({ id: 0n, owner: ctx.sender, value: 1 });  // Insert (0n for autoInc)
ctx.db.scoreRecord.id.find(recordId);                     // Find by PK → row | null
ctx.db.entity.identity.find(ctx.sender);                   // Find by unique column
[...ctx.db.post.authorId.filter(authorId)];                // Filter → spread to Array
[...ctx.db.entity.iter()];                                 // All rows → Array
ctx.db.scoreRecord.id.update({ ...existing, value: 2 });  // Update (spread + override)
ctx.db.scoreRecord.id.delete(recordId);                   // Delete by PK
```

Insert through the table accessor (`ctx.db.scoreRecord.insert(...)`). Primary-key, unique, and index accessors support lookup or mutation of existing rows, but do not have `insert(...)`.

`insert(...)` returns the inserted row, including database-assigned auto-increment fields.

The accessor for a primary key or index is the declared column name. For example, a primary key named `eventId` is accessed as `ctx.db.event.eventId`, not `ctx.db.event.id`.

The schema value registers module exports but does not expose database rows. Pass a context into any helper that needs `ctx.db`.

Note: `iter()` and `filter()` return iterators. Spread to Array for `.sort()`, `.filter()`, `.map()`.

## Lifecycle Hooks

MUST be `export const`. Bare calls are silently ignored:

```typescript
export const init = spacetimedb.init((ctx) => { ... });
export const onConnect = spacetimedb.clientConnected((ctx) => { ... });
export const onDisconnect = spacetimedb.clientDisconnected((ctx) => { ... });
```

`ctx.connectionId` is `ConnectionId | null`, including in lifecycle contexts. Guard it before passing it to a helper or using it as a table key.

## Reducer Context API

`ctx` is the only source of sender identity, time, and randomness; stdlib clocks and RNG are unavailable in modules. Let exported callbacks infer their context type. In helpers, use `ReducerCtx<InferSchema<typeof spacetimedb>>`; do not annotate a context as `any`, because that erases table row types and can make `bigint` expressions infer as `number`.

```typescript
type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

function findRecord(ctx: Ctx, id: bigint) {
  return ctx.db.scoreRecord.id.find(id);
}
```

```typescript
// Auth: ctx.sender is the caller's Identity
if (!row.owner.equals(ctx.sender)) throw new SenderError('unauthorized');

// ctx.connectionId: the per-connection id, NULLABLE (ConnectionId | null) — null-check before use.
// One Identity can hold several connections (multiple tabs/devices).
if (ctx.connectionId) { /* ... */ }

// Server timestamp (deterministic per reducer call)
ctx.db.item.insert({ id: 0n, createdAt: ctx.timestamp });

// Deterministic RNG
const f: number = ctx.random();                          // [0.0, 1.0)
const roll: number = ctx.random.integerInRange(1, 6);    // safe JS number bounds/result, inclusive
const storedRoll: bigint = BigInt(roll);                 // convert the result for an i64/u64 column
const bytes: Uint8Array = ctx.random.fill(new Uint8Array(16));
// 2.13+: in-place shuffle; copy first to preserve the original array.
const shuffled = ctx.random.shuffle([...cards]);

// Client: Timestamp → Date
new Date(Number(row.createdAt.microsSinceUnixEpoch / 1000n));
```

Do not construct `Identity` values from strings (e.g. `'hex' as Identity`): serialization fails and kills the module. Identities come from `ctx.sender` or `t.identity()` columns.

Construct a `ConnectionId` from its numeric representation with `new ConnectionId(value)` after importing `ConnectionId` from `spacetimedb`.

Construct exact timestamps with `new Timestamp(micros)` after importing `Timestamp` from `spacetimedb`. Inclusive index ranges use `Range` from `spacetimedb/server`:

```typescript
import { Timestamp } from 'spacetimedb';
import { Range } from 'spacetimedb/server';

ctx.db.shipment.deliverBy.filter(new Range(
  { tag: 'included', value: new Timestamp(1_000n) },
  { tag: 'included', value: new Timestamp(2_000n) },
));
```

## Scheduled Tables

The reducer or procedure referenced by a table's `scheduled` option must be exported.

```typescript
import { ScheduleAt } from 'spacetimedb';   // ScheduleAt comes from the root package

const tickTimer = table({
  name: 'tick_timer',
}, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

export const tick = spacetimedb.reducer(
  { onSchedule: tickTimer },
  { timer: tickTimer.rowType },
  (ctx, { timer }) => { /* timer row auto-deleted after this runs */ }
);

// `onSchedule` also works for scheduled procedures whose return type is `t.unit()`.
// Legacy table-side scheduling, `scheduled: (): any => tick`, still works but is not
// recommended for new code because it forces a forward reference.

// One-time: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + delayMicros)
// Repeating: ScheduleAt.interval(60_000_000n)
// Read time back from a scheduleAt value (tagged union):
//   const micros = at.tag === 'time' ? at.value : at.value.microsSinceUnixEpoch;  // bigint
```

## Submodules

Import the library's full module-namespace object, not just its default schema:

```typescript
import * as authLib from 'auth_lib';

const spacetimedb = schema({
  scoreRecord,
  myAuth: { name: 'auth_data', module: authLib },
});
export default spacetimedb;
```

`myAuth` is the accessor (`ctx.db.myAuth.<table>`); `auth_data` is the canonical namespace used in SQL and wire names. Without an explicit `name`, the root's case policy derives it (`myAuth` → `my_auth` by default). Pin `name` when renaming an accessor: changing the canonical namespace drops its tables and their data. The library keeps its own flat `ctx.db` accessors. To call a library function directly, pass `ctx.as.myAuth`; inside `withTx`, use `tx.as.myAuth`. Nested TypeScript submodules are supported. Lifecycle reducers and nonempty environment declarations belong in the root. Submodule routers are ignored; register delegated handlers on the root router. Composition is not cross-language.

Official reusable libraries include `@spacetimedb/cron`, `@spacetimedb/retry`, `@spacetimedb/rate-limit`, and `@spacetimedb/crypto`. Their registration shapes differ: `@spacetimedb/rate-limit/submodule` is mountable, cron/retry expose factories, and crypto exports helpers. Consult the chosen package's README/exports rather than assuming every package root is a mountable module.

## Environment Variables

```typescript
const spacetimedb = schema({ scoreRecord }, {
  env: {
    API_KEY: t.string(),
    MODE: t.enum('Mode', ['development', 'production']),
    LOG_LEVEL: t.string().optional(),
  },
});
// In a root reducer/procedure/view/handler:
// ctx.env.API_KEY: string; ctx.env.LOG_LEVEL: string | undefined
// ctx.env.get('LOG_LEVEL'): string | null
```

See the concepts skill for shared environment and secret-handling rules.

## Inter-Database Calls (Async IDC)

A reducer calls a reducer in another database by inserting a row into an outbox table. The call is sent only if the transaction commits, runs exactly once, and runs in order with other calls through the same outbox to the same database. The sending reducer doesn't wait for it. Both databases must be on the same server.

Generate receiver bindings by listing the receiving module under `dependencies` in the sending database's `spacetime.json`, then running `spacetime generate <sending-database>`. TypeScript bindings are written to `src/remote_bindings/`.

```json
{
  "database": "lobby",
  "module-path": "./lobby",
  "dependencies": [{ "name": "game_world", "database": "game-world" }],
  "children": [{ "database": "game-world", "module-path": "./game_world" }]
}
```

```typescript
import gw from './remote_bindings/game_world';

// Each row is one call to game_world's `admitPlayer({ name })` reducer.
const admitPlayerOutbox = table(
  { outbox: { receiver: gw.reducers.admitPlayer } },
  {
    msgId: t.u64().primaryKey().autoInc(), // exactly one u64 autoInc primary key
    world: gw.identity().target(),         // exactly one target, typed by the bindings
    name: t.string(),                      // one column per reducer parameter, same name and type
    // playerName: t.string().param({ name: 'name' }),  // alias a column to a parameter
    // Extra columns are allowed. They aren't sent, but onResult can read them.
  }
);
// Shorthand: gw.outbox.admitPlayer() declares { msgId, target, ...params } for you.
// It can't be used for a reducer with a parameter named msgId or target.

const spacetimedb = schema({ admitPlayerOutbox });
export default spacetimedb;

export const sendToWorld = spacetimedb.reducer(
  { name: t.string(), world: gw.identity() },
  (ctx, { name, world }) => {
    // Sent if and only if this transaction commits.
    ctx.db.admitPlayerOutbox.insert({ msgId: 0n, world, name });
  }
);

// Optional, at most one per outbox. Private. Runs once per row, then the row is deleted.
export const onAdmitPlayerResult = spacetimedb.reducer(
  { onResult: admitPlayerOutbox },
  { row: admitPlayerOutbox.rowType, result: t.result(t.unit(), t.string()) },
  (ctx, { row, result }) => {
    if ('err' in result) console.warn(`${row.name} was not admitted: ${result.err}`);
  }
);
```

- The receiving reducer is an ordinary reducer and needs no changes. In it, `ctx.sender` is the sending database's identity, so authorize calls by checking it against an allow-list table.
- The receiving database runs `clientConnected` and `clientDisconnected` around every delivered call, with no JWT. If `clientConnected` rejects the sending database, the call is retried forever.
- Outbox rows are insert-only, so a pending call can't be cancelled. A call is never retried once it has a result. To try again, insert a new row, for example from `onResult`.
- A plain `Identity` can't be a target. Use values typed `gw.identity()`, such as reducer arguments or columns of that type. Index lookups on those columns accept a plain `Identity`.
- An outbox table can't also be a scheduled table or an event table.
- After the receiving reducer's parameters change, regenerate the bindings and republish the sending database. Calls built from old bindings fail with a signature mismatch error.

See https://spacetimedb.com/docs/databases/inter-database-communication for details.

## Custom Types

```typescript
// Product type (struct):
const Position = t.object('Position', { x: t.i32(), y: t.i32() });
const entity = table({ name: 'entity' }, {
  id: t.u64().primaryKey().autoInc(),
  pos: Position,
});

// Sum type (tagged union):
const Shape = t.enum('Shape', {
  circle: t.i32(),
  rectangle: t.object('Rect', { w: t.i32(), h: t.i32() }),
});
// Values: { tag: 'circle', value: 10 }
```

## Views

A client subscribing to a view receives only the rows it returns. Use a per-user view
(keyed on `ctx.sender`) for per-viewer access control: deleting a row it depends on
(e.g. a membership row) automatically drops the rows it was exposing from that client.

`t.row(...)` and `t.object(...)` return schema builders, not TypeScript runtime row types. Let a view callback infer its result, or annotate a separately declared structural type such as `Array<{ sku: bigint; label: string }>`. A named output type must not reuse the generated PascalCase name of its view accessor (for example, reserve `DiscountedProduct` for a `discounted_product` view).

Without parameters, `spacetimedb.view(...)` and `spacetimedb.anonymousView(...)` take view options, a return schema, and a callback. Parameterized views add an argument-schema object before the return schema.

```typescript
// Anonymous view (same for all clients):
export const activeUsers = spacetimedb.anonymousView(
  { name: 'active_users', public: true },
  t.array(entity.rowType),
  (ctx) => [...ctx.db.entity.iter()].filter(e => e.active)
);

// Per-user view (varies by ctx.sender):
export const myProfile = spacetimedb.view(
  { name: 'my_profile', public: true },
  t.option(entity.rowType),
  (ctx) => ctx.db.entity.identity.find(ctx.sender) ?? undefined
);
```

For a procedural view primary key, define the output with `t.row` and mark its field `.primaryKey()`:

```typescript
const CatalogKey = t.row('CatalogKey', {
  sku: t.u64().primaryKey(),
  label: t.string(),
});
```

Query-builder views use `ctx.from` and return the query directly. Because a query returns a row set, declare its return schema as `t.array(tableName.rowType)`. Use `where` for predicates and `rightSemijoin` when the result should contain right-side rows that have a matching left-side row:

```typescript
ctx => ctx.from.article.where(article => article.published.eq(true))
ctx => ctx.from.subscription.rightSemijoin(
  ctx.from.account,
  (subscription, account) => subscription.accountId.eq(account.id)
)
```

The method name identifies which side is returned: `A.leftSemijoin(B, ...)` returns rows from `A`, while `A.rightSemijoin(B, ...)` returns rows from `B`. To return one table's rows when another table has a match, put the returned table on the corresponding side. Semijoins do not project combined columns from both tables.

Procedural views read through `ctx.db` and return materialized values such as arrays. Query-builder values from `ctx.from` are returned directly; they are not iterators and cannot be spread, looped over, or mixed with array methods. Use a procedural view when the result is a custom row assembled from multiple tables.

Parameterized views (2.13+) pass arguments to the callback as an object:

```typescript
export const entityById = spacetimedb.anonymousView(
  { public: true },
  { identity: t.identity() },
  t.option(entity.rowType),
  (ctx, { identity }) => ctx.db.entity.identity.find(identity) ?? undefined
);
```

Floating-point arguments are rejected. Views with arguments have no primary key; TypeScript omits primary-key metadata from the returned row type automatically. See client skills for SQL subscription syntax and restrictions.

## Client Visibility Filters

```typescript
export const privateNoteFilter = spacetimedb.clientVisibilityFilter.sql(
  'SELECT * FROM owned_row WHERE owner = :sender'
);
```

## Procedures and HTTP

`spacetimedb` is the local schema value returned by `schema({...})`; it is not a named export to import from `spacetimedb/server`.

Procedures declare argument and return types:

```typescript
const Result = t.object('Result', { value: t.string() });

export const inspect = spacetimedb.procedure(
  { input: t.string() },
  Result,
  (_ctx, { input }) => ({ value: input })
);
```

Procedure callbacks are synchronous. Do not mark them `async` or use `await`; return the declared value directly. A procedure with return type `t.unit()` returns `{}`.

TypeScript outbound HTTP uses `ctx.http.fetch(url, options)`, including for non-GET requests; it does not provide convenience methods such as `get()` or `post()`. Responses expose the numeric `status`, `headers.get(name)`, and `text()` APIs.

`t.array(t.u8())` values are `number[]`. Convert one to `new Uint8Array(value)` before using it as a binary request body.

Procedures and handlers open short database transactions with `ctx.withTx(tx => ...)`. Perform network I/O before opening the transaction; only database work belongs inside its callback.

Scheduled procedures use the same `onSchedule` binding as scheduled reducers. The procedure must be exported, return `t.unit()`, and accept the scheduled row as its argument.

Inbound HTTP uses `httpHandler`, `httpRouter`, `Router`, and `SyncResponse`:

`httpHandler` and `httpRouter` are methods on the local `spacetimedb` schema value, not named imports.

```typescript
import { Router, SyncResponse } from 'spacetimedb/server';

export const health = spacetimedb.httpHandler((_ctx, _request) =>
  new SyncResponse('ok', {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  })
);
export const routes = spacetimedb.httpRouter(new Router().get('/health', health));
```

Handlers are synchronous: return `SyncResponse` directly rather than marking the callback `async`. Pass the exported `httpHandler(...)` value to the router, not its raw callback. The router selects the path, while a handler reads request data with APIs such as `request.text()`; `Request` has no `path` property. A handler context does not expose `ctx.db`; use `ctx.withTx(tx => ...)` when a handler needs transactional database access.

## Module Unit Tests

Use `spacetimedb` 2.12+ and Node.js 22+ in the **module** project, not the client. Set `"type": "module"` in `package.json` and install the test runner with `npm install --save-dev vitest@^3.2.4`. Configure the host-import replacement:

```typescript
// vitest.config.ts
import { defineConfig, type Plugin } from 'vitest/config';
import { spacetimedbModuleTestPlugin } from 'spacetimedb/server/test-utils/vitest';

export default defineConfig({
  plugins: [spacetimedbModuleTestPlugin() as unknown as Plugin],
  test: { environment: 'node' },
});
```

```typescript
// src/index.test.ts, for the addRecord reducer above
import { expect, it } from 'vitest';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import spacetimedb, * as moduleExports from './index';

it('inserts a record', () => {
  const test = createModuleTestHarness(spacetimedb, moduleExports);
  test.withReducerTx(TestAuth.internal(), ctx => {
    moduleExports.addRecord(ctx, { value: 1 });
  });
  expect(test.db.scoreRecord.count()).toBe(1n);
});
```

Run `npx vitest run`. Create a fresh harness per test. `withReducerTx` commits on normal return and rolls back/rethrows on exceptions; do not catch a failure inside the transaction if rollback is expected. Callbacks must be synchronous. Use `TestAuth.fromJwtPayload(JSON.stringify({ iss: 'test', sub: 'alice' }), connectionId)` for client authorization tests; internal auth represents the database, not a client or the publisher. The harness exposes `clock`, `rng`, procedure/view contexts, and query execution. It does not simulate subscriptions, RLS, lifecycle calls, or scheduling; invoke lifecycle/scheduled reducers explicitly and retain live integration tests for those host behaviors.
