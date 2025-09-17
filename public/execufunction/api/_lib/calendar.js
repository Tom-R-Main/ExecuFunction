// Minimal ICS parsing and next-3 selection without external deps.
// Reads ICS from STATIC_ICS_URL if available; otherwise uses a small sample.
const https = require('https');
const http = require('http');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error('Bad status ' + res.statusCode));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('Timeout fetching ICS'));
    });
  });
}

function parseICS(icsText) {
  // Very minimal: extract DTSTART, DTEND, SUMMARY from VEVENT blocks.
  const lines = icsText.split(/\r?\n/);
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) {
      ev = {};
    } else if (line.startsWith('END:VEVENT')) {
      if (ev && ev.start && ev.end) events.push(ev);
      ev = null;
    } else if (ev) {
      if (line.startsWith('DTSTART')) {
        const [, val] = line.split(':');
        ev.start = icsDateToIso(val);
      } else if (line.startsWith('DTEND')) {
        const [, val] = line.split(':');
        ev.end = icsDateToIso(val);
      } else if (line.startsWith('SUMMARY')) {
        const [, val] = line.split(':');
        ev.title = (val || '').trim();
      }
    }
  }
  return events
    .filter(e => e.start)
    .map(e => ({
      title: e.title || 'Event',
      start: e.start,
      end: e.end || null
    }));
}

function icsDateToIso(s) {
  // Handles YYYYMMDD or YYYYMMDDThhmmssZ
  if (!s) return null;
  if (/^\d{8}T\d{6}Z$/.test(s)) {
    const yyyy = s.slice(0, 4);
    const mm = s.slice(4, 6);
    const dd = s.slice(6, 8);
    const hh = s.slice(9, 11);
    const min = s.slice(11, 13);
    const sec = s.slice(13, 15);
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}Z`;
  }
  if (/^\d{8}$/.test(s)) {
    const yyyy = s.slice(0, 4);
    const mm = s.slice(4, 6);
    const dd = s.slice(6, 8);
    return `${yyyy}-${mm}-${dd}T00:00:00Z`;
  }
  return null;
}

const SAMPLE_ICS = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART:20250101T170000Z\nDTEND:20250101T173000Z\nSUMMARY:Sample Meeting\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20260101T120000Z\nDTEND:20260101T123000Z\nSUMMARY:Future Event\nEND:VEVENT\nEND:VCALENDAR`;

async function getEventsFromIcs() {
  const url = process.env.STATIC_ICS_URL;
  let text = SAMPLE_ICS;
  if (url) {
    try {
      text = await fetchText(url);
    } catch (_e) {
      // fall back to sample
    }
  }
  return parseICS(text);
}

function nextN(events, n = 3) {
  const now = Date.now();
  return events
    .filter(e => Date.parse(e.end || e.start || 0) >= now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, n);
}

module.exports = { getEventsFromIcs, nextN };

