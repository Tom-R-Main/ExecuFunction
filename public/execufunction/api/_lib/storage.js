const { TableClient } = require('@azure/data-tables');

const conn = process.env.STORAGE_CONNECTION_STRING;
if (!conn && process.env.NODE_ENV !== 'development') {
  console.warn('STORAGE_CONNECTION_STRING not configured');
}

function getTableClient(tableName) {
  if (!conn) {
    throw new Error('STORAGE_CONNECTION_STRING missing');
  }
  return TableClient.fromConnectionString(conn, tableName, { 
    allowInsecureConnection: false 
  });
}

async function ensureTable(tableName) {
  const client = getTableClient(tableName);
  try {
    await client.createTable();
  } catch (err) {
    if (!err.message?.includes('TableAlreadyExists')) {
      throw err;
    }
  }
  return client;
}

module.exports = {
  getTableClient,
  ensureTable
};