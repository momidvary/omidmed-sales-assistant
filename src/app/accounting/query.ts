import type { createClient } from "@/lib/supabase/server";

export type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Reads every page of a query; PostgREST returns at most 1000 rows at a time. */
export async function readAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
  limit = 20_000,
) {
  const rows: T[] = [];
  for (let offset = 0; offset < limit; offset += 1000) {
    const { data, error } = await query(offset, offset + 999);
    if (error) return { rows, error: true as const };
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return { rows, error: false as const };
}
