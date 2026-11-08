// Structured log for the main process: one JSON object per line, rotated by size.
//
// The shell's own decisions — an update offered, verified, refused or installed; a navigation or a
// certificate refused — happen where no developer tools are open and on machines support cannot
// reach. Writing them to a file the user can send (Help → open logs folder) is what makes a failed
// update diagnosable. Nothing a page renders, and no URL query string, is ever logged: the query of
// an ERP URL can carry a record id or a token.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

/** Strip query and fragment from anything that looks like a URL before it reaches the log. */
function redact(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\b(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1');
}

function createLogger({ directory, fileName = 'main.log', echo = false } = {}) {
  const file = directory ? path.join(directory, fileName) : null;
  if (directory) {
    try {
      fs.mkdirSync(directory, { recursive: true });
    } catch {
      // Logging must never be the reason the application fails to start.
    }
  }

  function rotate() {
    try {
      if (!file || fs.statSync(file).size < MAX_BYTES) return;
    } catch {
      return;
    }
    for (let i = KEEP - 1; i >= 1; i -= 1) {
      try {
        fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
      } catch {
        /* the older generation may not exist yet */
      }
    }
    try {
      fs.renameSync(file, `${file}.1`);
    } catch {
      /* best effort */
    }
  }

  function write(level, event, fields = {}) {
    const entry = { time: new Date().toISOString(), level, event };
    for (const [key, value] of Object.entries(fields)) {
      entry[key] = value instanceof Error ? redact(value.message) : redact(value);
    }
    const line = `${JSON.stringify(entry)}\n`;
    if (echo) process.stdout.write(line);
    if (!file) return;
    try {
      rotate();
      fs.appendFileSync(file, line, { mode: 0o600 });
    } catch {
      /* best effort */
    }
  }

  const logger = {
    file,
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
  // electron-updater calls `logger.info(message)` with free text; keep those under one event name.
  logger.updaterAdapter = {
    info: (message) => write('info', 'updater', { message: String(message) }),
    warn: (message) => write('warn', 'updater', { message: String(message) }),
    error: (message) => write('error', 'updater', { message: String(message) }),
    debug: () => undefined,
  };
  return logger;
}

module.exports = { createLogger, redact, MAX_BYTES, KEEP };
