# Waitlist & Contact System Implementation

## Overview
The Executive Function website now has a complete waitlist and contact system using Azure Static Web Apps with integrated Azure Functions and Azure Table Storage.

## Architecture

```
Frontend (HTML/JS)
    ↓
Azure Static Web Apps
    ↓
Azure Functions (/api/*)
    ↓
Azure Table Storage
  - waitlist (email signups)
  - contact (messages)
  - throttle (rate limiting)
  - suppression (opt-outs)
```

## Features

### 1. Waitlist Signup (`/api/join-waitlist`)
- Email validation and normalization
- Duplicate detection (returns friendly message if already signed up)
- Rate limiting (1 request per email per minute)
- UTM parameter tracking for marketing attribution
- Privacy-first: emails are hashed in logs
- Consent tracking (opt-in by default)

### 2. Contact Form (`/api/contact`)
- Modal popup for easy access
- Message validation (min 5 characters)
- Topic inference (investor, press, clinician, general)
- Priority flagging for important messages
- Messages capped at 2000 characters

### 3. Admin Export (`/api/admin/export`)
- Protected by function key
- CSV export of waitlist or contact data
- Date range filtering
- Includes all tracking data (UTM, tags, consent)

## Setup Instructions

1. **Deploy to Azure Static Web Apps** (already done via GitHub Actions)

2. **Configure Azure Storage:**
   ```bash
   ./setup-storage.sh
   ```
   This script will:
   - Create a storage account
   - Create required tables
   - Configure app settings with connection string

3. **Get Admin Function Key:**
   - Go to Azure Portal → Your Static Web App
   - Navigate to Functions
   - Find `admin-export` 
   - Copy the function key

4. **Access Admin Export:**
   ```
   https://execufunction.com/api/admin/export?code=YOUR_KEY
   ```
   Optional parameters:
   - `&table=waitlist` or `&table=contact`
   - `&from=2025-09` (start month)
   - `&to=2025-12` (end month)

## Frontend Integration

### Waitlist Form
The waitlist form on the contact page automatically:
- Captures UTM parameters from URL
- Shows loading state during submission
- Displays success/error messages
- Handles duplicate signups gracefully

### Contact Modal
Click "Contact" button on homepage to:
- Open a modal with email and message fields
- Send message without exposing your email
- Get confirmation when message is sent

## Data Model

### Waitlist Table
- **PartitionKey**: YYYY-MM (month for efficient queries)
- **RowKey**: SHA256(email) (deduplication)
- **Fields**: email, timestamp, utm_source, utm_medium, utm_campaign, tags, consent, referrer

### Contact Table
- **PartitionKey**: YYYY-MM-DD (daily partitions)
- **RowKey**: SHA256(email)#nanoid
- **Fields**: email, message, topic, priority, timestamp

### Throttle Table
- **PartitionKey**: YYYYMMDDHHmm (minute buckets)
- **RowKey**: SHA256(email#ip)
- Auto-cleanup after 7 days (optional)

## Security & Privacy

- All API responses include `Cache-Control: no-store`
- Emails are hashed before logging
- IP addresses are hashed, not stored raw
- HTTPS-only with strict transport security
- Function key required for admin endpoints
- No PII in application logs

## Testing

### Test Waitlist Signup:
```javascript
fetch('/api/join-waitlist', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    email: 'test@example.com',
    utm_source: 'test',
    tags: ['adhd']
  })
})
```

### Test Contact Form:
```javascript
fetch('/api/contact', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    email: 'test@example.com',
    message: 'This is a test message'
  })
})
```

## Future Enhancements

1. **Email Notifications (Phase 2)**
   - Azure Communication Services for sending emails
   - Double opt-in confirmation flow
   - Auto-forward contact messages to tom@winonaos.com

2. **Advanced Segmentation**
   - Tag users by interest/condition
   - Segment by engagement level
   - Custom export filters

3. **Admin Dashboard**
   - Protected admin page for data management
   - Search and filter capabilities
   - One-click actions (resend, tag, suppress)

## Monitoring

- Check Application Insights for function logs
- Monitor 5xx errors and throttling rates
- Review weekly signup trends in CSV exports

## Troubleshooting

**"Storage not configured" error:**
Run `./setup-storage.sh` to set up Azure Storage

**429 Too Many Requests:**
Rate limiting is working correctly (1 request per minute per email/IP)

**Export returns empty CSV:**
Check date range parameters and ensure data exists in that range

**Contact form not working:**
Ensure JavaScript is enabled and check browser console for errors