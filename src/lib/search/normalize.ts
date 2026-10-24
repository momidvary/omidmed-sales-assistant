const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

export function normalizeSearchText(value: string) {
  return value
    .trim()
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("fa");
}

/** Arabic ي/ى/ك (common in Holoo names) as the Persian letters. */
export function persianLetters(value: string) {
  return value.replace(/[يى]/g, "ی").replace(/ك/g, "ک");
}

export function escapeLike(value: string) {
  return value.replace(/[%_]/g, "");
}
