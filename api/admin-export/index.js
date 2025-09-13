const { getTableClient } = require('../_lib/storage');

module.exports = async function (context, req) {
  try {
    // Parse query parameters for date range
    const from = req.query.from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 7); // Default: last 90 days
    const to = req.query.to || new Date().toISOString().slice(0, 7); // Default: current month
    const table = req.query.table || 'waitlist'; // Default to waitlist, can also export 'contact'
    
    if (!process.env.STORAGE_CONNECTION_STRING) {
      return context.res = { 
        status: 503, 
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Storage not configured' } 
      };
    }

    const tableClient = getTableClient(table);
    const rows = [];
    
    // Build CSV header based on table type
    let csvHeader;
    if (table === 'waitlist') {
      csvHeader = 'email,timestamp,utm_source,utm_medium,utm_campaign,tags,consent,referrer';
    } else if (table === 'contact') {
      csvHeader = 'email,timestamp,topic,message_preview,priority';
    } else {
      return context.res = { 
        status: 400, 
        body: { error: 'Invalid table. Use "waitlist" or "contact"' } 
      };
    }
    
    // Query entities within date range
    // Note: Table Storage queries on PartitionKey are efficient
    const fromMonth = from.slice(0, 7);
    const toMonth = to.slice(0, 7);
    
    // Generate list of months to query (PartitionKeys)
    const months = [];
    let currentDate = new Date(fromMonth + '-01');
    const endDate = new Date(toMonth + '-01');
    
    while (currentDate <= endDate) {
      months.push(currentDate.toISOString().slice(0, 7));
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
    
    // Query each month partition
    for (const month of months) {
      try {
        const query = tableClient.listEntities({
          queryOptions: {
            filter: `PartitionKey eq '${month}'`
          }
        });
        
        for await (const entity of query) {
          if (table === 'waitlist') {
            rows.push([
              entity.email || '',
              entity.ts || '',
              entity.utm_source || '',
              entity.utm_medium || '',
              entity.utm_campaign || '',
              entity.tags || '',
              entity.consent || '',
              entity.ref || ''
            ].map(escapeCSV).join(','));
          } else if (table === 'contact') {
            const messagePreview = (entity.msg || '').slice(0, 50).replace(/\n/g, ' ');
            rows.push([
              entity.email || '',
              entity.ts || '',
              entity.topic || '',
              messagePreview,
              entity.priority || false
            ].map(escapeCSV).join(','));
          }
        }
      } catch (err) {
        context.log.warn(`Failed to query month ${month}:`, err.message);
      }
    }
    
    // Sort by timestamp (newest first)
    rows.sort((a, b) => {
      const tsA = a.split(',')[1];
      const tsB = b.split(',')[1];
      return tsB.localeCompare(tsA);
    });
    
    const csv = csvHeader + '\n' + rows.join('\n');
    
    context.log(`Admin export: ${table}, ${rows.length} rows, from ${from} to ${to}`);
    
    return context.res = {
      status: 200,
      headers: { 
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${table}-export-${new Date().toISOString().slice(0, 10)}.csv"`
      },
      body: csv
    };
  } catch (err) {
    context.log.error('admin-export error', err);
    return context.res = { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Export failed' } 
    };
  }
};

function escapeCSV(value) {
  value = String(value || '');
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}