const crypto = require('crypto');
const { ensureTable } = require('../_lib/storage');

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async function (context, req) {
  try {
    const { email, utm_source, utm_medium, utm_campaign, tags } = (req.body || {});
    
    // Validate email
    if (!email || !emailRe.test(String(email).toLowerCase())) {
      return context.res = { 
        status: 400, 
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
        body: { ok: false, error: 'invalid_email' } 
      };
    }

    const normalizedEmail = email.toLowerCase().trim();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const minute = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''); // YYYYMMDDHHmm
    const throttleKey = crypto.createHash('sha256').update(`${normalizedEmail}#${ip}#${minute}`).digest('hex');

    // Throttle check - use storage table for distributed throttling
    if (process.env.STORAGE_CONNECTION_STRING) {
      try {
        const throttleTable = await ensureTable('throttle');
        // Check if throttle entry exists
        try {
          await throttleTable.getEntity(minute, throttleKey);
          return context.res = { 
            status: 429, 
            headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
            body: { ok: false, error: 'too_many_requests' } 
          };
        } catch (e) {
          // Not found - create throttle entry
          if (e.statusCode === 404) {
            await throttleTable.createEntity({ 
              partitionKey: minute, 
              rowKey: throttleKey, 
              at: new Date().toISOString() 
            });
          }
        }

        // Store waitlist entry
        const month = new Date().toISOString().slice(0, 7); // YYYY-MM for partitioning
        const waitlistTable = await ensureTable('waitlist');
        
        // Check if already exists
        const emailHash = crypto.createHash('sha256').update(normalizedEmail).digest('hex');
        let existing = false;
        try {
          await waitlistTable.getEntity(month, emailHash);
          existing = true;
        } catch (e) {
          // Not found - that's fine
        }

        // Upsert the entity
        await waitlistTable.upsertEntity({
          partitionKey: month,
          rowKey: emailHash,
          email: normalizedEmail,
          ua: String(req.headers['user-agent'] || '').slice(0, 200),
          ref: String(req.headers['referer'] || ''),
          ip_hash: ip !== 'unknown' ? crypto.createHash('sha256').update(ip).digest('hex') : '',
          ts: new Date().toISOString(),
          utm_source: utm_source || '',
          utm_medium: utm_medium || '',
          utm_campaign: utm_campaign || '',
          tags: tags ? tags.join(',') : 'general',
          consent: 'opt-in'
        }, 'Replace');

        // Log (hash email for privacy)
        context.log('waitlist signup', { 
          emailHash: crypto.createHash('sha256').update(normalizedEmail).digest('hex'),
          existing 
        });

        return context.res = { 
          status: existing ? 200 : 201, 
          headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
          body: { ok: true, already: existing } 
        };
      } catch (err) {
        context.log.error('Storage error:', err);
        // Fall back to success even if storage fails
        return context.res = { 
          status: 201, 
          headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
          body: { ok: true } 
        };
      }
    } else {
      // No storage configured - just log and return success
      context.log('Waitlist signup (no storage)', { 
        emailHash: crypto.createHash('sha256').update(normalizedEmail).digest('hex') 
      });
      return context.res = { 
        status: 201, 
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
        body: { ok: true } 
      };
    }
  } catch (err) {
    context.log.error('join-waitlist error', err);
    return context.res = { 
      status: 500, 
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
      body: { ok: false, error: 'server_error' } 
    };
  }
};

