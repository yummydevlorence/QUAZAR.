// Builds quazar.db from schema.sql + seed.sql
// Usage (from the project folder):  node database/setup-db.js
// WARNING: this DELETES and recreates all tables.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'quazar.db');
const db = new Database(dbPath);

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
db.exec(fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8'));

const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
console.log(`Database ready at ${dbPath} with ${count} products.`);
db.close();
