const MEETING_URL = /https:\/\/(?:meet\.google\.com\/[a-z-]+|[\w.-]*zoom\.us\/j\/\d+[^\s"<>\\]*|teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>\\]+)/i;

const unescapeText = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

// Offset (ms) of `tz` from UTC at the instant `utcMs`.
function tzOffset(utcMs, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(utcMs)).map((x) => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

function parseDate(value, params) {
  const m = value.match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?$/);
  if (!m) return null;
  const [y, mo, d, h = 0, mi = 0, s = 0] = m.slice(1, 7).map(Number);
  const allDay = m[4] === undefined;
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  if (m[7]) return { ms: wall, allDay };
  const tz = /TZID=([^;:]+)/.exec(params)?.[1];
  if (tz) {
    try {
      const first = wall - tzOffset(wall, tz);
      return { ms: wall - tzOffset(first, tz), allDay };
    } catch {} // Windows-style TZID: treat as floating local time
  }
  return { ms: new Date(y, mo - 1, d, h, mi, s).getTime(), allDay };
}

// Non-recurring events only: RRULE is not expanded.
export function parseIcs(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = { props: {} }; continue; }
    if (line === 'END:VEVENT') {
      const p = ev.props;
      const start = p.DTSTART && parseDate(p.DTSTART.value, p.DTSTART.params);
      if (start && p.STATUS?.value !== 'CANCELLED') {
        const hay = ['LOCATION', 'DESCRIPTION', 'X-GOOGLE-CONFERENCE'].map((k) => (p[k] ? unescapeText(p[k].value) : '')).join(' ');
        events.push({
          uid: p.UID?.value ?? `${p.DTSTART.value}-${p.SUMMARY?.value}`,
          title: p.SUMMARY ? unescapeText(p.SUMMARY.value) : 'Réunion',
          start: start.ms, allDay: start.allDay, url: hay.match(MEETING_URL)?.[0] ?? null,
        });
      }
      ev = null;
      continue;
    }
    if (!ev) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    ev.props[name.toUpperCase()] = { value: line.slice(i + 1), params: params.join(';') };
  }
  return events;
}

// Timed events starting within `aheadMs` from now (or that started under a minute ago).
export const upcoming = (events, now, aheadMs = 120000) =>
  events.filter((e) => !e.allDay && e.start - now <= aheadMs && e.start - now >= -60000).sort((a, b) => a.start - b.start);

export function startCalendar({ getUrl, onUpcoming, log = console.error }) {
  let events = [];
  const seen = new Set();
  const refresh = async () => {
    const url = getUrl();
    if (!url) { events = []; return; }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      events = parseIcs(await res.text());
    } catch (e) { log('calendrier :', e.message); }
  };
  const check = () => {
    for (const e of upcoming(events, Date.now())) {
      const key = `${e.uid}@${e.start}`;
      if (!seen.has(key)) { seen.add(key); onUpcoming(e); return; }
    }
  };
  refresh();
  const t1 = setInterval(refresh, 5 * 60000);
  const t2 = setInterval(check, 30000);
  return { refresh, stop: () => { clearInterval(t1); clearInterval(t2); } };
}
