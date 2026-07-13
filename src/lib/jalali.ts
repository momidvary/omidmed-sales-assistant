function div(a: number, b: number) {
  return Math.trunc(a / b);
}

function mod(a: number, b: number) {
  return a - Math.trunc(a / b) * b;
}

function jalCal(jy: number, withoutLeap = false) {
  const breaks = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060,
    2097, 2192, 2262, 2324, 2394, 2456, 3178,
  ];

  const bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jm = 0;
  let jump = 0;
  let leap = 0;
  let n = 0;

  if (jy < jp || jy >= breaks[bl - 1]) {
    throw new Error("Invalid Jalali year");
  }

  for (let i = 1; i < bl; i += 1) {
    jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }

  n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);

  if (mod(jump, 33) === 4 && jump - n === 4) {
    leapJ += 1;
  }

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (withoutLeap) return { gy, march, leap: 0 };

  if (jump - n < 6) {
    n = n - jump + div(jump + 4, 33) * 33;
  }

  leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;

  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number) {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;

  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number) {
  const r = jalCal(jy, true);
  return (
    g2d(r.gy, 3, r.march) +
    (jm - 1) * 31 -
    div(jm, 7) * (jm - 7) +
    jd -
    1
  );
}

export function isJalaliLeapYear(year: number) {
  try {
    return jalCal(year).leap === 0;
  } catch {
    return false;
  }
}

export function getJalaliMonthLength(year: number, month: number) {
  if (month >= 1 && month <= 6) return 31;
  if (month >= 7 && month <= 11) return 30;
  if (month === 12) return isJalaliLeapYear(year) ? 30 : 29;
  return 0;
}

export function jalaliToGregorian(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || year < 1200 || year > 1700) return null;
  const monthLength = getJalaliMonthLength(year, month);
  if (!monthLength || day < 1 || day > monthLength) return null;

  try {
    return d2g(j2d(year, month, day));
  } catch {
    return null;
  }
}

export function getCurrentJalaliDate() {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Tehran",
  }).formatToParts(new Date());

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
  };
}

export function parseJalaliTehranDateTime({
  year,
  month,
  day,
  time,
}: {
  year: string;
  month: string;
  day: string;
  time: string;
}) {
  const hasAnyValue = Boolean(year.trim() || month.trim() || day.trim() || time.trim());
  if (!hasAnyValue) return { value: null, error: null };

  const jy = Number(year);
  const jm = Number(month);
  const jd = Number(day);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time.trim());

  if (!timeMatch) return { value: null, error: "invalid" as const };

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { value: null, error: "invalid" as const };
  }

  const gregorian = jalaliToGregorian(jy, jm, jd);
  if (!gregorian) return { value: null, error: "invalid" as const };

  const pad = (value: number) => String(value).padStart(2, "0");
  const value = `${gregorian.gy}-${pad(gregorian.gm)}-${pad(gregorian.gd)}T${pad(hour)}:${pad(minute)}:00+03:30`;

  return { value, error: null };
}
