const zone = 'Asia/Jakarta';
const isoParts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const readable = new Intl.DateTimeFormat('id-ID', { timeZone: zone, dateStyle: 'long' });
const readableTime = new Intl.DateTimeFormat('id-ID', { timeZone: zone, dateStyle: 'long', timeStyle: 'short' });

export function jakartaDate(now: Date) {
  const parts = Object.fromEntries(isoParts.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function calendarDay(year: number, month: number, day: number) {
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return;
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function addMonths(day: string, amount: number) {
  const date = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  const days = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(Number(day.slice(-2)), days));
  return date.toISOString().slice(0, 10);
}

export function weekStart(day: string) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

export function monthRange(day: string) {
  const from = `${day.slice(0, 7)}-01`;
  return { from, to: addDays(addMonths(from, 1), -1) };
}

export const endOfJakartaDay = (day: string) => `${day}T23:59:59.999999+07:00`;
export const startOfJakartaDay = (day: string) => `${day}T00:00:00+07:00`;

export function spokenDay(instant: string) {
  const date = new Date(instant.length === 10 ? `${instant}T12:00:00+07:00` : instant);
  return readable.format(date);
}

export function spokenTime(instant: string) {
  return `${readableTime.format(new Date(instant))} WIB`;
}
