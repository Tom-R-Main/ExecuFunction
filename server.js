// server.js
import express from 'express';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DB connection via private IP in VPC
const pool = new pg.Pool({
  host: process.env.DB_HOST || '10.138.64.3', // Private IP of Cloud SQL instance
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  // No SSL needed for private IP connection within VPC
});

const app = express();
app.set('trust proxy', 1); // Trust first proxy (Cloud Run load balancer)
app.disable('etag'); // mirror your "don't cache OAuth-ish endpoints" learning
app.use(express.json());

// Serve static files from public/execufunction directory
app.use(express.static(path.join(__dirname, 'public/execufunction')));

const apiNoStore = (req, res, next) => {
  res.set('Cache-Control','no-store, no-cache, must-revalidate, private');
  res.set('Pragma','no-cache');
  res.set('Vary','Authorization');
  next();
};

const joinLimiter = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false });

app.post('/api/join-waitlist', apiNoStore, joinLimiter, async (req, res) => {
  const { email, utm_source, utm_medium, utm_campaign, tags = [] } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'Invalid email'});

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dedup = await client.query(
      `select id from waitlist_entries where email = $1::email_citext limit 1`, [email]
    );
    if (dedup.rowCount) {
      await client.query(
        `insert into outreach_events(id, waitlist_entry_id, kind, details)
         values (gen_random_uuid(), $1, 'repeat_signup', jsonb_build_object('ts', now()))`,
        [dedup.rows[0].id]
      );
      await client.query('COMMIT');
      return res.status(200).json({ already: true });
    }
    const inserted = await client.query(
      `insert into waitlist_entries
         (id, email, utm_source, utm_medium, utm_campaign, tags)
       values (gen_random_uuid(), $1::email_citext, $2, $3, $4, $5::text[])
       returning id`,
      [email, utm_source, utm_medium, utm_campaign, tags]
    );
    await client.query(
      `insert into outreach_events(id, waitlist_entry_id, kind, details)
       values (gen_random_uuid(), $1, 'signup', jsonb_build_object('ts', now()))`,
      [inserted.rows[0].id]
    );
    await client.query('COMMIT');
    return res.status(201).json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Database error:', e);
    if (e.code === '23505') { return res.status(200).json({ already: true }); } // unique collision
    return res.status(500).json({ error:'Server error' });
  } finally {
    client.release();
  }
});

app.post('/api/contact', apiNoStore, async (req, res) => {
  const { email, message } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message || message.trim().length < 5) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  await pool.query(
    `insert into contact_messages(id, email, message)
     values (gen_random_uuid(), $1::email_citext, $2)`,
    [email, message.trim()]
  );
  // Optionally enqueue an email via Cloud Tasks or call SendGrid here.
  return res.status(201).json({ ok: true });
});

// Catch-all route for SPA - serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/execufunction', 'index.html'));
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log('exf-api listening on', port));
