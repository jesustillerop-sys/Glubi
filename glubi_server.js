#!/usr/bin/env node
'use strict';

const server = require('./core/server.js');

if (require.main === module) server.start();

module.exports = server;
