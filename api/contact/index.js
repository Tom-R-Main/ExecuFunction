const crypto = require('crypto');
const { ensureTable } = require('../_lib/storage');

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async function (context, req) {
  try {
    const { email, message, topic } = (req.body || {});
    
    // Validate email
    if (!email || !emailRe.test(String(email).toLowerCase())) {
      return context.res = { 
        status: 400, 
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
        body: { ok: false, error: 'invalid_email' } 
      };
    }
    
    // Validate message
    if (!message || String(message).trim().length < 5) {
      return context.res = { 
        status: 400, 
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
        body: { ok: false, error: 'message_too_short' } 
      };
    }

    const normalizedEmail = email.toLowerCase().trim();
    const cleanMessage = String(message).slice(0, 2000);
    
    // Infer topic from keywords if not provided
    let inferredTopic = topic || 'general';
    if (!topic) {
      const msgLower = cleanMessage.toLowerCase();
      if (msgLower.includes('invest') || msgLower.includes('funding')) {
        inferredTopic = 'investor';
      } else if (msgLower.includes('press') || msgLower.includes('media') || msgLower.includes('article')) {
        inferredTopic = 'press';
      } else if (msgLower.includes('clinic') || msgLower.includes('doctor') || msgLower.includes('patient')) {
        inferredTopic = 'clinician';
      }
    }

    if (process.env.STORAGE_CONNECTION_STRING) {
      try {
        const contactTable = await ensureTable('contact');
        const now = new Date().toISOString();
        const key = crypto.createHash('sha256')
          .update(normalizedEmail + '#' + now)
          .digest('hex')
          .slice(0, 32); // Shorter key for readability
        
        await contactTable.createEntity({
          partitionKey: now.slice(0, 10), // YYYY-MM-DD
          rowKey: key,
          email: normalizedEmail,
          msg: cleanMessage,
          topic: inferredTopic,
          ua: String(req.headers['user-agent'] || '').slice(0, 200),
          ts: now,
          priority: inferredTopic !== 'general'
        });

        // Log (hash email for privacy)
        context.log('contact form submission', { 
          emailHash: crypto.createHash('sha256').update(normalizedEmail).digest('hex'),
          topic: inferredTopic,
          messageLength: cleanMessage.length
        });

        // TODO: Phase 2 - Send email notification via Azure Communication Services
        // if (process.env.ACS_CONNECTION_STRING && process.env.CONTACT_TO) {
        //   await sendNotificationEmail(normalizedEmail, cleanMessage, inferredTopic);
        // }

        return context.res = { 
          status: 201, 
          headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
          body: { ok: true } 
        };
      } catch (err) {
        context.log.error('Storage error:', err);
        // Still return success to user
        return context.res = { 
          status: 201, 
          headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
          body: { ok: true } 
        };
      }
    } else {
      // No storage configured - just log and return success
      context.log('Contact form (no storage)', { 
        emailHash: crypto.createHash('sha256').update(normalizedEmail).digest('hex'),
        topic: inferredTopic 
      });
      return context.res = { 
        status: 201, 
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
        body: { ok: true } 
      };
    }
  } catch (err) {
    context.log.error('contact error', err);
    return context.res = { 
      status: 500, 
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
      body: { ok: false, error: 'server_error' } 
    };
  }
};