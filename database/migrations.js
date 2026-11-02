'use strict';

module.exports = [
  {
    version: 1,
    sql: `
      CREATE TABLE documents (
        name TEXT PRIMARY KEY,
        json TEXT NOT NULL CHECK (json_valid(json)),
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE backups (
        path TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );
    `
  }
];
