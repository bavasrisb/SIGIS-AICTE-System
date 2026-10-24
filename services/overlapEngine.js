// Overlap Detection Engine for AICTE Grievance System (SIGIS)
// SIH Problem Statement SIH26264

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for',
  'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him',
  'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more',
  'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
  'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your',
  'yours', 'yourself', 'yourselves', 'institute', 'college', 'aicte', 'complaint', 'grievance', 'matter'
]);

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2 && !STOP_WORDS.has(token))
    .map(stemWord);
}

function stemWord(word) {
  // Simple suffix stemmer for clean token alignment
  return word
    .replace(/(ing|edly|ingly|ed|es|s|ment|tion|al|ity)$/, '')
    .trim();
}

function termFrequency(tokens) {
  const tf = {};
  for (const t of tokens) {
    if (!t) continue;
    tf[t] = (tf[t] || 0) + 1;
  }
  return tf;
}

function cosineSimilarity(tf1, tf2) {
  const terms = new Set([...Object.keys(tf1), ...Object.keys(tf2)]);
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (const term of terms) {
    const val1 = tf1[term] || 0;
    const val2 = tf2[term] || 0;
    dotProduct += val1 * val2;
    mag1 += val1 * val1;
    mag2 += val2 * val2;
  }

  if (mag1 === 0 || mag2 === 0) return 0;
  return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

function jaccardSimilarity(tokens1, tokens2) {
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  if (set1.size === 0 && set2.size === 0) return 0;

  let intersection = 0;
  for (const item of set1) {
    if (set2.has(item)) intersection++;
  }

  const union = set1.size + set2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function extractKeywords(tokens1, tokens2) {
  const set1 = new Set(tokens1);
  const common = [];
  for (const t of tokens2) {
    if (set1.has(t) && !common.includes(t)) {
      common.push(t);
    }
  }
  return common.slice(0, 8);
}

/**
 * Calculates similarity between two complaints
 * @param {Object} a - First complaint object
 * @param {Object} b - Second complaint object
 * @returns {Object} { score, breakdown, reasons, commonKeywords }
 */
function compareComplaints(a, b) {
  // 1. Institution Match
  const sameInst = a.institution_id === b.institution_id;
  const instScore = sameInst ? 1.0 : 0.0;

  // 2. Category Match
  let catScore = 0.0;
  if (a.category === b.category) {
    catScore = 1.0;
  } else if (
    (a.category.includes('Ragging') && b.category.includes('Harassment')) ||
    (a.category.includes('Certificate') && b.category.includes('Refund')) ||
    (a.category.includes('Unapproved') && b.category.includes('Capitation'))
  ) {
    catScore = 0.5;
  }

  // 3. Text Similarity (Subject weighted x2 + Description)
  const fullTextA = `${a.subject} ${a.subject} ${a.description}`;
  const fullTextB = `${b.subject} ${b.subject} ${b.description}`;

  const tokensA = tokenize(fullTextA);
  const tokensB = tokenize(fullTextB);

  const tfA = termFrequency(tokensA);
  const tfB = termFrequency(tokensB);

  const cosine = cosineSimilarity(tfA, tfB);
  const jaccard = jaccardSimilarity(tokensA, tokensB);
  const textScore = 0.65 * cosine + 0.35 * jaccard;

  // Weighted overall calculation:
  // - Institution match is necessary for institutional grievance duplication (40% weight)
  // - Category match (25% weight)
  // - Text similarity (35% weight)
  let totalScore = 0;
  if (sameInst) {
    totalScore = (0.40 * instScore) + (0.25 * catScore) + (0.35 * textScore);
  } else {
    // If different institutions, cross-institution overlap is only flagged if text is extraordinarily identical
    totalScore = (0.35 * textScore);
  }

  const percentage = Math.min(100, Math.round(totalScore * 100));
  const reasons = [];

  if (sameInst) {
    reasons.push(`Target identical institution (${a.institution_id})`);
  }
  if (a.bureau !== b.bureau) {
    reasons.push(`Cross-Bureau routing (${a.bureau} ↔ ${b.bureau})`);
  } else {
    reasons.push(`Same Bureau (${a.bureau})`);
  }
  if (catScore === 1.0) {
    reasons.push(`Identical category: ${a.category}`);
  } else if (catScore > 0) {
    reasons.push(`Related category match`);
  }
  if (textScore > 0.35) {
    reasons.push(`High textual similarity (${Math.round(textScore * 100)}% match)`);
  }

  const commonKeywords = extractKeywords(tokensA, tokensB);

  let severity = 'LOW';
  if (percentage >= 75) severity = 'CRITICAL';
  else if (percentage >= 60) severity = 'HIGH';
  else if (percentage >= 45) severity = 'MODERATE';

  return {
    score: percentage,
    severity,
    breakdown: {
      institution: Math.round(instScore * 100),
      category: Math.round(catScore * 100),
      text: Math.round(textScore * 100)
    },
    reasons,
    commonKeywords,
    sameInst
  };
}

/**
 * Scan all complaints and return pairs that exceed the overlap threshold
 */
function detectAllOverlaps(complaints, existingReviews = []) {
  const reviewsMap = new Map();
  for (const rev of existingReviews) {
    const key = [rev.complaint_a_id, rev.complaint_b_id].sort().join('::');
    reviewsMap.set(key, rev);
  }

  const detected = [];

  for (let i = 0; i < complaints.length; i++) {
    for (let j = i + 1; j < complaints.length; j++) {
      const a = complaints[i];
      const b = complaints[j];

      const comparison = compareComplaints(a, b);

      // Flag pairs with score >= 45% (or any same institution with related category and text match)
      if (comparison.score >= 45) {
        const pairKey = [a.id, b.id].sort().join('::');
        const existingReview = reviewsMap.get(pairKey) || null;

        detected.push({
          complaintA: a,
          complaintB: b,
          similarity: comparison.score,
          severity: comparison.severity,
          breakdown: comparison.breakdown,
          reasons: comparison.reasons,
          commonKeywords: comparison.commonKeywords,
          reviewStatus: existingReview ? existingReview.review_status : 'PENDING_REVIEW',
          reviewId: existingReview ? existingReview.id : null,
          reviewerNotes: existingReview ? existingReview.reviewer_notes : null,
          reviewedBy: existingReview ? existingReview.reviewed_by : null,
          reviewedAt: existingReview ? existingReview.reviewed_at : null
        });
      }
    }
  }

  // Sort by highest similarity score first
  return detected.sort((x, y) => y.similarity - x.similarity);
}

module.exports = {
  compareComplaints,
  detectAllOverlaps,
  tokenize
};
