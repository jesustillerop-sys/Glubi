'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const migrations = require('./migrations.js');

module.exports = function createDatabaseStore({ dir }) {
  const databaseDir = path.join(dir, 'database');
  const backupDir = path.join(databaseDir, 'backups');
  const databasePath = path.join(databaseDir, 'glubi.sqlite');
  fs.mkdirSync(backupDir, { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);');

  const hasMigration = database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
  const recordMigration = database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
  for (const migration of migrations) {
    if (hasMigration.get(migration.version)) continue;
    database.exec('BEGIN');
    try {
      database.exec(migration.sql);
      recordMigration.run(migration.version, Date.now());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw new Error(`No se pudo aplicar la migración SQLite ${migration.version}: ${error.message}`);
    }
  }

  const selectDocument = database.prepare('SELECT json FROM documents WHERE name = ?');
  const insertDocument = database.prepare(
    'INSERT INTO documents (name, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at'
  );
  const selectLatestBackup = database.prepare('SELECT created_at FROM backups ORDER BY created_at DESC LIMIT 1');
  const recordBackup = database.prepare('INSERT INTO backups (path, created_at) VALUES (?, ?)');
  const invalidSources = new Set();

  function validateName(name) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]+\.json$/.test(name)) {
      throw new Error('Nombre de documento JSON inválido para SQLite.');
    }
  }

  function readJSON(name, fallback) {
    validateName(name);
    const stored = selectDocument.get(name);
    if (stored) {
      try {
        return JSON.parse(stored.json);
      } catch (error) {
        throw new Error(`El documento SQLite ${name} no contiene JSON válido: ${error.message}`);
      }
    }

    const file = path.join(dir, name);
    let value;
    try {
      value = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return fallback;
      if (error instanceof SyntaxError) {
        if (!invalidSources.has(name)) {
          const contents = fs.readFileSync(file);
          const existingArchive = fs.readdirSync(backupDir)
            .filter(archive => archive.startsWith(`${name}.`) && archive.endsWith('.invalid'))
            .find(archive => fs.readFileSync(path.join(backupDir, archive)).equals(contents));
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const archiveName = existingArchive || `${name}.${stamp}.invalid`;
          if (!existingArchive) fs.writeFileSync(path.join(backupDir, archiveName), contents);
          invalidSources.add(name);
          console.warn(`El archivo ${name} no contiene JSON válido; se conservó en database/backups/${archiveName} y se usarán valores por defecto.`);
        }
        return fallback;
      }
      throw new Error(`No se pudo importar ${name} a SQLite: ${error.message}`);
    }
    insertDocument.run(name, JSON.stringify(value), Date.now());
    return value;
  }

  function writeJSON(name, value) {
    validateName(name);
    const json = JSON.stringify(value);
    if (typeof json !== 'string') throw new Error(`No se pudo serializar ${name} como JSON.`);

    insertDocument.run(name, json, Date.now());
    const file = path.join(dir, name);
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
      fs.renameSync(temporary, file);
    } catch (error) {
      if (fs.existsSync(temporary)) fs.rmSync(temporary);
      throw new Error(`SQLite guardó ${name}, pero no se pudo actualizar su copia JSON: ${error.message}`);
    }
  }

  function backup({ force = false } = {}) {
    const latest = selectLatestBackup.get();
    if (!force && latest && Date.now() - latest.created_at < 24 * 60 * 60 * 1000) return null;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(backupDir, `glubi-${stamp}.sqlite`);
    const escaped = file.replace(/'/g, "''");
    try {
      database.exec(`VACUUM INTO '${escaped}'`);
      recordBackup.run(path.basename(file), Date.now());
      return file;
    } catch (error) {
      throw new Error(`No se pudo crear el backup SQLite: ${error.message}`);
    }
  }

  return { readJSON, writeJSON, backup, close: () => database.close() };
};
