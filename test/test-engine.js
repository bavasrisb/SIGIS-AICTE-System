const { db } = require('../db');
const { detectAllOverlaps } = require('../services/overlapEngine');

const complaints = db.prepare('SELECT * FROM complaints').all();
const reviews = db.prepare('SELECT * FROM overlap_reviews').all();

console.log(`Loaded ${complaints.length} complaints. Running overlap detection engine...`);
const overlaps = detectAllOverlaps(complaints, reviews);

console.log(`\nDetected ${overlaps.length} potential overlap pairs:\n`);
for (const pair of overlaps) {
  console.log(`------------------------------------------------------------`);
  console.log(`Pair: [${pair.complaintA.id}] (${pair.complaintA.bureau})`);
  console.log(`  vs: [${pair.complaintB.id}] (${pair.complaintB.bureau})`);
  console.log(`Institution: ${pair.complaintA.institution_id}`);
  console.log(`Similarity: ${pair.similarity}% | Severity: ${pair.severity}`);
  console.log(`Keywords: [${pair.commonKeywords.join(', ')}]`);
  console.log(`Reasons: ${pair.reasons.join('; ')}`);
}
