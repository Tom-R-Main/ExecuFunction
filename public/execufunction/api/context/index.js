const { getEventsFromIcs, nextN } = require('../_lib/calendar');

module.exports = async function (context, req) {
  try {
    const now = new Date();
    let events = [];
    try {
      const all = await getEventsFromIcs();
      events = nextN(all, 3);
    } catch (_e) {
      events = [];
    }
    const envelope = {
      now_iso: now.toISOString(),
      tz: 'America/Chicago',
      next_3_events: events,
      in_progress_task: null,
      selected_task: null,
      deadline_soon: false
    };
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache'
      },
      body: envelope
    };
  } catch (err) {
    context.log.error('context/envelope error', err);
    context.res = {
      status: 500,
      headers: {
        'Cache-Control': 'no-store'
      },
      body: { error: 'internal_error' }
    };
  }
};

