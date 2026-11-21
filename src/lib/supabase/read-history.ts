/** Reads every page of a query; PostgREST returns at most 1000 rows at a time. */
export async function readHistory<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await query(offset, offset + 999);
    if (error) {
      const code = typeof error === "object" && "code" in error ? error.code : undefined;
      return { rows, error: true, code };
    }
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) return { rows, error: false };
  }
}
