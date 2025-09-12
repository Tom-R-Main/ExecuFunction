const crypto = require('crypto');

function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

async function storeIfConfigured(context, email) {
  const conn = process.env.STORAGE_CONNECTION_STRING;
  if (!conn) return; // no-op without storage
  try {
    const { TableClient } = require('@azure/data-tables');
    const table = TableClient.fromConnectionString(conn, 'waitlist');
    await table.createTable({ onResponse: () => {} }).catch(() => {});
    const entity = {
      partitionKey: new Date().toISOString().slice(0, 10),
      rowKey: crypto.createHash('sha1').update(email).digest('hex'),
      email,
      ts: new Date().toISOString(),
      consent: true
    };
    await table.upsertEntity(entity, 'Replace');
  } catch (e) {
    context.log.warn('waitlist storage skipped', e.message);
  }
}

const throttle = new Map(); // best-effort, stateless envs may reset

module.exports = async function (context, req) {
  try {
    const body = req.body || {};
    const email = (body.email || '').trim();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown';

    if (!validEmail(email)) {
      context.res = {
        status: 400,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: { error: 'invalid_email' }
      };
      return;
    }

    // Simple in-process throttle to deter rapid repeats
    const key = `${email}:${new Date().toISOString().slice(0, 16)}`; // minute granularity
    if (throttle.has(key)) {
      context.res = {
        status: 429,
        headers: { 'Cache-Control': 'no-store' },
        body: { error: 'too_many' }
      };
      return;
    }
    throttle.set(key, true);
    setTimeout(() => throttle.delete(key), 61 * 1000);

    await storeIfConfigured(context, email);
    context.log('Waitlist signup', { email, ip });
    context.res = {
      status: 201,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: { ok: true }
    };
  } catch (err) {
    context.log.error('join-waitlist error', err);
    context.res = { status: 500, headers: { 'Cache-Control': 'no-store' }, body: { error: 'internal_error' } };
  }
};

