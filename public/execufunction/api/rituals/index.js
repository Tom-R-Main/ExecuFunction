// Ritual logging endpoint - two-minute check-ins for ADHD support
// Minimal fields: mood, note, timestamp
// Privacy-first: no-store headers, minimal data retention

const crypto = require('crypto');

const VALID_MOODS = ['great', 'good', 'ok', 'struggling', 'bad'];

async function storeRitual(context, data) {
  const conn = process.env.STORAGE_CONNECTION_STRING;
  if (!conn) {
    // Log-only mode when storage isn't configured
    context.log('Ritual check-in (no storage):', { 
      mood: data.mood, 
      noteLength: data.note?.length || 0 
    });
    return;
  }
  
  try {
    const { TableClient } = require('@azure/data-tables');
    const table = TableClient.fromConnectionString(conn, 'rituals');
    
    // Create table if it doesn't exist
    await table.createTable({ onResponse: () => {} }).catch(() => {});
    
    // Minimal storage: partition by date, row by timestamp+random
    const now = new Date();
    const entity = {
      partitionKey: now.toISOString().slice(0, 10), // YYYY-MM-DD
      rowKey: `${now.getTime()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: now.toISOString(),
      mood: data.mood,
      note: data.note || '',
      // Could add user_id here when auth is implemented
    };
    
    await table.upsertEntity(entity, 'Replace');
    context.log('Ritual stored successfully');
  } catch (err) {
    context.log.warn('Failed to store ritual:', err.message);
    // Don't fail the request if storage fails
  }
}

module.exports = async function (context, req) {
  try {
    const body = req.body || {};
    const mood = (body.mood || '').toLowerCase().trim();
    const note = (body.note || '').trim();
    
    // Validate mood
    if (!mood || !VALID_MOODS.includes(mood)) {
      context.res = {
        status: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, private',
          'Pragma': 'no-cache'
        },
        body: { 
          error: 'invalid_mood',
          valid_moods: VALID_MOODS 
        }
      };
      return;
    }
    
    // Validate note length (keep it short for 2-minute check-ins)
    if (note.length > 500) {
      context.res = {
        status: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, private',
          'Pragma': 'no-cache'
        },
        body: { 
          error: 'note_too_long',
          max_length: 500 
        }
      };
      return;
    }
    
    // Store the ritual
    await storeRitual(context, { mood, note });
    
    // Return success with no-store headers for privacy
    context.res = {
      status: 201,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      body: { 
        ok: true,
        message: 'Check-in recorded'
      }
    };
    
  } catch (err) {
    context.log.error('rituals/log error:', err);
    context.res = {
      status: 500,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: { error: 'internal_error' }
    };
  }
};