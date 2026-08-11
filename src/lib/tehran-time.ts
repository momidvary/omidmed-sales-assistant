const TEHRAN_TIME_ZONE = "Asia/Tehran";
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const tehranFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TEHRAN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formattedParts(date: Date): DateTimeParts {
  const values: Record<string, number> = {};
  for (const part of tehranFormatter.formatToParts(date)) {
    if (["year", "month", "day", "hour", "minute"].includes(part.type)) {
      values[part.type] = Number(part.value);
    }
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function sameParts(a: DateTimeParts, b: DateTimeParts) {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

function validGregorianParts(parts: DateTimeParts) {
  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > 31 ||
    parts.hour < 0 ||
    parts.hour > 23 ||
    parts.minute < 0 ||
    parts.minute > 59
  ) {
    return false;
  }
  const probe = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute),
  );
  return (
    probe.getUTCFullYear() === parts.year &&
    probe.getUTCMonth() === parts.month - 1 &&
    probe.getUTCDate() === parts.day &&
    probe.getUTCHours() === parts.hour &&
    probe.getUTCMinutes() === parts.minute
  );
}

/**
 * Converts an HTML datetime-local wall-clock value into a real instant while
 * explicitly interpreting that wall clock in Asia/Tehran. This must not rely
 * on the Vercel/Node host timezone, which is normally UTC.
 */
export function parseTehranLocalDateTime(value: string): Date | null {
  const match = value.trim().match(LOCAL_DATE_TIME_PATTERN);
  if (!match) return null;

  const requested: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  if (!validGregorianParts(requested)) return null;

  const wallClockAsUtc = Date.UTC(
    requested.year,
    requested.month - 1,
    requested.day,
    requested.hour,
    requested.minute,
  );

  // Determine the zone offset at an initial guess, then once more at the
  // candidate instant. The second pass keeps the conversion correct even for
  // time zones whose offset changes around the requested wall clock.
  let candidateMs = wallClockAsUtc;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const zoneParts = formattedParts(new Date(candidateMs));
    const zoneWallClockAsUtc = Date.UTC(
      zoneParts.year,
      zoneParts.month - 1,
      zoneParts.day,
      zoneParts.hour,
      zoneParts.minute,
    );
    const offsetMs = zoneWallClockAsUtc - candidateMs;
    candidateMs = wallClockAsUtc - offsetMs;
  }

  const candidate = new Date(candidateMs);
  if (!sameParts(formattedParts(candidate), requested)) return null;
  return candidate;
}

export function tehranDateTimeToIso(value: string) {
  return parseTehranLocalDateTime(value)?.toISOString() ?? null;
}
