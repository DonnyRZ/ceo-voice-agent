const dateFormat = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
})
const monthFormat = new Intl.DateTimeFormat('id-ID', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
})
const timeFormat = new Intl.DateTimeFormat('id-ID', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
})

export function taskDate(date: string) {
  return dateFormat.format(new Date(`${date.slice(0, 10)}T00:00:00Z`))
}

export function shortTaskDate(date: string) {
  return taskDate(date).replace(/ \d{4}$/, '')
}

export function taskTime(time: string) {
  return `${timeFormat.format(new Date(time))} WIB`
}

export function monthName(month: string) {
  return monthFormat.format(new Date(`${month}-01T00:00:00Z`))
}

export function monthRange(month: string) {
  const from = `${month}-01`
  const last = new Date(`${from}T00:00:00Z`)
  last.setUTCMonth(last.getUTCMonth() + 1, 0)
  return { from, to: last.toISOString().slice(0, 10) }
}

export function currentMonth() {
  return new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric', month: '2-digit', timeZone: 'Asia/Jakarta',
  }).format(new Date())
}

export function recentMonths(recordMonths: string[]) {
  const start = new Date(`${currentMonth()}-01T00:00:00Z`)
  const candidates = new Set(recordMonths)
  for (let offset = 0; offset < 12; offset += 1) {
    candidates.add(start.toISOString().slice(0, 7))
    start.setUTCMonth(start.getUTCMonth() - 1)
  }
  return [...candidates].sort().reverse()
}
