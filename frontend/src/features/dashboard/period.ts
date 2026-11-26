const timeZone = 'Asia/Jakarta';
const monthFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone,
  month: 'long',
  year: 'numeric',
});
const dayFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function currentMonth() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit' })
    .format(new Date());
}

export function monthTitle(month: string) {
  return monthFormatter.format(new Date(`${month}-01T00:00:00Z`));
}

export function monthFilters(month: string) {
  const end = new Date(`${month}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return new URLSearchParams({ from: `${month}-01`, to: end.toISOString().slice(0, 10) }).toString();
}

export function formatDay(day: string) {
  return dayFormatter.format(new Date(`${day}T00:00:00Z`));
}
