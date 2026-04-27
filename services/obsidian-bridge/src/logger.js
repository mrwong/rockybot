'use strict';

function log(level, msg, ...args) {
  const ts = new Date().toISOString();
  const extra = args.length ? ' ' + args.map(a => JSON.stringify(a)).join(' ') : '';
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}${extra}`);
}

module.exports = {
  info:  (msg, ...a) => log('info',  msg, ...a),
  warn:  (msg, ...a) => log('warn',  msg, ...a),
  error: (msg, ...a) => log('error', msg, ...a),
  debug: (msg, ...a) => log('debug', msg, ...a),
};
