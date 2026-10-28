import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, upcoming } from '../src/main/calendar.js';

const ics = (body) => `BEGIN:VCALENDAR\r\n${body}\r\nEND:VCALENDAR\r\n`;
const ev = (lines) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT\r\n`;

test('UTC event with a Meet link in the description (folded line, escaped text)', () => {
  const [e] = parseIcs(ics(ev([
    'UID:a@x', 'DTSTART:20260715T080000Z', 'SUMMARY:Point hebdo\\, équipe',
    'DESCRIPTION:Rejoindre : https://meet.google.com/abc-defg-\r\n hij\\nA bientôt',
  ])));
  assert.equal(e.start, Date.UTC(2026, 6, 15, 8));
  assert.equal(e.title, 'Point hebdo, équipe');
  assert.equal(e.url, 'https://meet.google.com/abc-defg-hij');
  assert.equal(e.allDay, false);
});

test('TZID events are converted to UTC, with daylight saving', () => {
  const [summer, winter] = parseIcs(ics(
    ev(['UID:1', 'DTSTART;TZID=Europe/Paris:20260715T100000', 'SUMMARY:Été']) +
    ev(['UID:2', 'DTSTART;TZID=Europe/Paris:20261215T100000', 'SUMMARY:Hiver'])));
  assert.equal(summer.start, Date.UTC(2026, 6, 15, 8));
  assert.equal(winter.start, Date.UTC(2026, 11, 15, 9));
});

test('Zoom and Teams links are found in LOCATION', () => {
  const [z, t] = parseIcs(ics(
    ev(['UID:1', 'DTSTART:20260101T100000Z', 'LOCATION:https://us02web.zoom.us/j/123456789?pwd=abc']) +
    ev(['UID:2', 'DTSTART:20260101T100000Z', 'LOCATION:https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0?context=1'])));
  assert.equal(z.url, 'https://us02web.zoom.us/j/123456789?pwd=abc');
  assert.match(t.url, /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//);
});

test('all-day events are flagged and cancelled events dropped', () => {
  const events = parseIcs(ics(
    ev(['UID:1', 'DTSTART;VALUE=DATE:20260715', 'SUMMARY:Férié']) +
    ev(['UID:2', 'DTSTART:20260715T080000Z', 'STATUS:CANCELLED'])));
  assert.equal(events.length, 1);
  assert.equal(events[0].allDay, true);
});

test('upcoming keeps timed events starting within 2 minutes, ignoring all-day and far ones', () => {
  const now = Date.UTC(2026, 6, 15, 8);
  const events = [
    { uid: 'soon', start: now + 90000, allDay: false },
    { uid: 'late', start: now + 600000, allDay: false },
    { uid: 'allday', start: now + 60000, allDay: true },
    { uid: 'past', start: now - 3600000, allDay: false },
  ];
  assert.deepEqual(upcoming(events, now).map((e) => e.uid), ['soon']);
});
