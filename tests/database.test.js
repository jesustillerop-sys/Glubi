'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const createDatabaseStore = require('../database/store.js');

test('imports existing JSON, keeps its mirror updated, and creates a SQLite backup', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glubi-db-'));
  fs.writeFileSync(path.join(dir, 'positions.json'), JSON.stringify({ BTCUSDT: { entry: 100 } }));
  fs.writeFileSync(path.join(dir, 'memory.json'), '');
  const database = createDatabaseStore({ dir });
  t.after(() => {
    database.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.deepEqual(database.readJSON('positions.json', {}), { BTCUSDT: { entry: 100 } });
  assert.deepEqual(database.readJSON('memory.json', { samples: [] }), { samples: [] });
  assert.equal(fs.statSync(path.join(dir, 'memory.json')).size, 0);
  assert.ok(fs.readdirSync(path.join(dir, 'database', 'backups')).some(name => name.startsWith('memory.json.')));
  database.writeJSON('positions.json', { BTCUSDT: { entry: 120 } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'positions.json'), 'utf8')), { BTCUSDT: { entry: 120 } });
  assert.deepEqual(database.readJSON('positions.json', {}), { BTCUSDT: { entry: 120 } });

  const backup = database.backup({ force: true });
  assert.ok(backup);
  assert.ok(fs.existsSync(backup));
});
