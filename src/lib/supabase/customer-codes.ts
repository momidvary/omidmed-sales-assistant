import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;

// Supabase caps every response at 1000 rows, so one oversized range request
// silently returns only the first 1000 customers. Importers need the full
// code -> id map; otherwise existing customers look new and the insert hits
// the (owner_id, customer_code) unique index.
export async function fetchCustomerIdsByCode(supabase: SupabaseClient) {
  const idByCode = new Map<string, string>();

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("customers")
      .select("id,customer_code")
      .not("customer_code", "is", null)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    for (const row of data ?? []) {
      idByCode.set(row.customer_code as string, row.id as string);
    }
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }

  return idByCode;
}
