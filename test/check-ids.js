const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

const regex = /getElementById\(['"]([^'"]+)['"]\)/g;
let match;
const missing = new Set();
const found = new Set();
while ((match = regex.exec(js)) !== null) {
  const id = match[1];
  const hasId = html.includes(`id="${id}"`) || html.includes(`id='${id}'`);
  if (!hasId) {
    missing.add(id);
  } else {
    found.add(id);
  }
}
console.log('MISSING IDs:', Array.from(missing));
console.log('TOTAL MATCHED IDs:', found.size);
