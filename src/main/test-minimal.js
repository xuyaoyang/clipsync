console.log('process.type:', process.type);
console.log('process.versions.electron:', process.versions.electron);
console.log('process.versions.node:', process.versions.node);

// Try different require approaches
try {
  const e1 = require('electron');
  console.log('require(electron) typeof:', typeof e1, 'is string:', typeof e1 === 'string');
} catch(e) { console.log('require(electron) error:', e.message); }

try {
  const e2 = require('electron/main');
  console.log('require(electron/main) typeof:', typeof e2);
} catch(e) { console.log('require(electron/main) error:', e.message); }

console.log('module.paths:', module.paths.slice(0,3));
