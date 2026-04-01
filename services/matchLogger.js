const fs = require('fs');
const path = require('path');

const logPath = path.join(__dirname, '..', 'matchLogs.json');

function readLogs() {
  try {
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '[]', 'utf8');
    }
    return JSON.parse(fs.readFileSync(logPath, 'utf8'));
  } catch (error) {
    console.error('Failed to read match logs:', error.message);
    return [];
  }
}

function writeLogs(logs) {
  try {
    fs.writeFileSync(logPath, JSON.stringify(logs, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to write match logs:', error.message);
  }
}

function logMatchEvent(event) {
  const logs = readLogs();

  logs.push({
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    ...event,
  });

  const trimmed = logs.slice(-1000);
  writeLogs(trimmed);
}

module.exports = {
  logMatchEvent,
};