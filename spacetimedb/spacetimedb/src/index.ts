import { schema, table, t, SenderError } from 'spacetimedb/server';

const spacetimedb = schema({
  person: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      name: t.string(),
      email: t.string(),
      age: t.u32(),
      createdBy: t.identity(),
      createdAt: t.timestamp(),
      updatedAt: t.timestamp(),
    }
  ),
});
export default spacetimedb;

export const init = spacetimedb.init(_ctx => {});
export const onConnect = spacetimedb.clientConnected(_ctx => {});
export const onDisconnect = spacetimedb.clientDisconnected(_ctx => {});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(name: string, email: string, age: number) {
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanName) throw new SenderError('Name is required');
  if (cleanName.length > 100) throw new SenderError('Name is too long');
  if (cleanEmail && !EMAIL_RE.test(cleanEmail)) throw new SenderError('Email is invalid');
  if (age > 150) throw new SenderError('Age must be between 0 and 150');
  return { name: cleanName, email: cleanEmail, age };
}

export const addPerson = spacetimedb.reducer(
  { name: t.string(), email: t.string(), age: t.u32() },
  (ctx, args) => {
    const clean = validate(args.name, args.email, args.age);
    ctx.db.person.insert({
      id: 0n,
      ...clean,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
  }
);

export const updatePerson = spacetimedb.reducer(
  { id: t.u64(), name: t.string(), email: t.string(), age: t.u32() },
  (ctx, { id, ...args }) => {
    const existing = ctx.db.person.id.find(id);
    if (!existing) throw new SenderError('Person not found');
    const clean = validate(args.name, args.email, args.age);
    ctx.db.person.id.update({ ...existing, ...clean, updatedAt: ctx.timestamp });
  }
);

export const deletePerson = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  if (!ctx.db.person.id.delete(id)) throw new SenderError('Person not found');
});
