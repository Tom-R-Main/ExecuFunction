const { getEventsFromIcs, nextN } = require('../_lib/calendar');

module.exports = async function (context, req) {
  try {
    const events = nextN(await getEventsFromIcs(), 3);
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache'
      },
      body: { events }
    };
  } catch (err) {
    context.log.error('calendar/next3 error', err);
    context.res = {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
      body: { error: 'internal_error' }
    };
  }
};

