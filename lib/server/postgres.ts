// A parameterized D1 transport for PostgreSQL. Existing workflow SQL and atomic
// batches remain shared with Sites; only the small SQLite dialect surface changes.
export type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number | null };
export type Queryable = { query(sql: string, values?: unknown[]): Promise<QueryResult> };
export type PoolLike = Queryable & { connect(): Promise<Queryable & { release(): void }> };

export function postgresSql(sql: string) {
  const ignore = /^\s*INSERT OR IGNORE\b/i.test(sql);
  if (ignore) sql = sql.replace(/^\s*INSERT OR IGNORE\b/i, 'INSERT');
  let n = 0;
  // Quoted values, identifiers and comments are indivisible. Never rewrite their contents.
  const tokens = sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|--[^\n]*|\/\*[\s\S]*?\*\/|\b[A-Za-z_][A-Za-z_0-9]*\b|\?|[\s\S]/g) || [];
  let out = tokens.map((t, i) => /[A-Z]/.test(t) && /[a-z]/.test(t) && /^[A-Za-z_][A-Za-z_0-9]*$/.test(t) && tokens.slice(0, i).filter(v => v.trim()).at(-1)?.toUpperCase() === 'AS' ? `"${t}"` : t.toLowerCase() === 'json_object' ? '"json_object"' : t === '?' ? `$${++n}` : t.startsWith('`') ? `"${t.slice(1, -1)}"` : /^rowid$/i.test(t) ? '__rowid' : /^like$/i.test(t) ? 'ILIKE' : t).join('');
  if (ignore) {
    const returning = out.match(/\bRETURNING\b/i);
    const i = returning?.index ?? out.replace(/;\s*$/, '').length;
    out = out.slice(0, i) + ' ON CONFLICT DO NOTHING ' + out.slice(i);
  }
  return out;
}

function normalized(rows: Record<string, unknown>[]) {
  return rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== '__rowid').map(([key, value]) => {
    // pg returns int8/count as text. All application counters are safe integers.
    if (typeof value === 'bigint') return [key, Number(value)];
    return [key, value];
  })));
}

export function postgresDatabase(pool: PoolLike) {
  const execute = async (connection: Queryable, sql: string, args: unknown[]) => {
    let result: QueryResult;
    try { result = await connection.query(postgresSql(sql), args); }
    catch (error) {
      if ((error as { code?: string }).code === "23505") throw new Error("UNIQUE constraint failed");
      throw error;
    }
    return { results: normalized(result.rows), success: true, meta: { changes: result.rowCount ?? 0 } };
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    _sql: sql, _args: args,
    bind(...values: unknown[]) { return statement(sql, values); },
    async all<T = Record<string, unknown>>() { return await execute(pool, sql, args) as { results: T[]; success: boolean; meta: { changes: number } }; },
    async first<T = Record<string, unknown>>(column?: string): Promise<T | null> { const row = (await execute(pool, sql, args)).results[0]; return (column ? row?.[column] : row) as T ?? null; },
    async run() { return execute(pool, sql, args); },
  });
  return {
    prepare(sql: string) { return statement(sql); },
    async batch(statements: ReturnType<typeof statement>[]) {
      // Retry serialization conflicts as a complete transaction, never partial writes.
      for (let attempt = 0; ; attempt++) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
          const results = [];
          for (const s of statements) results.push(await execute(client, s._sql, s._args));
          await client.query('COMMIT');
          return results;
        } catch (error) {
          await client.query('ROLLBACK');
          if (attempt >= 2 || !['40001', '40P01'].includes((error as { code?: string }).code || '')) throw error;
        } finally { client.release(); }
      }
    },
  };
}
