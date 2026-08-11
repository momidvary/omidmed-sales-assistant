type SupabaseErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

const missingColumnCodes = new Set(["PGRST204", "42703"]);

function errorText(error: SupabaseErrorLike) {
  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase("en");
}

/**
 * Compatibility fallbacks are allowed only when PostgREST/Postgres explicitly
 * reports a missing column that belongs to a not-yet-applied Content Studio
 * migration. Network, RLS, constraint and data errors must surface normally;
 * treating those as an old schema can silently discard new fields.
 */
export function isMissingContentStudioSchemaColumn(
  error: unknown,
  expectedColumns: readonly string[],
) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return false;
  const value = error as SupabaseErrorLike;
  const code = typeof value.code === "string" ? value.code : "";
  if (!missingColumnCodes.has(code)) return false;
  const text = errorText(value);
  return expectedColumns.some((column) => text.includes(column.toLocaleLowerCase("en")));
}
