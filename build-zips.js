const fs = require('fs');
const path = require('path');

const norm = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\b(city of|municipality of|city|metropolitan|metro)\b/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const input = process.argv[2];
if (!input) throw new Error('Usage: node back-end/build-zips.js PH.txt');

const out = {};
for (const line of fs.readFileSync(input, 'utf8').split(/\r?\n/)) {
  const columns = line.split('\t');
  if (columns.length < 6 || !/^\d{4}$/.test(columns[1])) continue;
  const names = (out[columns[1]] ||= new Set());
  [columns[2], columns[3], columns[5], columns[7]].forEach((value) => {
    const name = norm(value);
    if (name) names.add(name);
  });
}

const codes = Object.fromEntries(Object.entries(out).map(([code, names]) => [code, [...names]]));
if (!Object.keys(codes).length) throw new Error('No Philippine postal codes found in the input file.');
fs.writeFileSync(path.join(__dirname, 'ph-zips.json'), JSON.stringify(codes));
console.log(Object.keys(codes).length, 'postal codes');
