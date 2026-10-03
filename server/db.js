const mysql = require('mysql2/promise');
module.exports = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'tl_app',
  password: process.env.DB_PASSWORD || 'tl_pass_123',
  database: process.env.DB_NAME || 'tenant_landlord',
  waitForConnections: true, connectionLimit: 10, dateStrings: true
});
