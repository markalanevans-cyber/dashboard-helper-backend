function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getConfidenceLabel(score) {
  if (score >= 80) return 'high';
  if (score >= 55) return 'medium';
  return 'low';
}

function buildReasonSummary(reasons, warnings, label) {
  if (label === 'high') {
    return reasons.length
      ? `Strong match: ${reasons.slice(0, 3).join(', ')}`
      : 'Strong match based on available vehicle data';
  }

  if (label === 'medium') {
    const base = reasons.length
      ? `Estimated match: ${reasons.slice(0, 2).join(', ')}`
      : 'Estimated match based on partial vehicle data';

    if (warnings.length) {
      return `${base}. ${warnings[0]}`;
    }

    return base;
  }

  if (warnings.length) {
    return `Low confidence: ${warnings[0]}`;
  }

  return 'Low confidence match based on limited vehicle data';
}

function buildConfidenceResult({
  score,
  reasons = [],
  warnings = [],
  topScore = null,
  secondScore = null,
}) {
  let adjustedScore = clamp(score, 0, 100);
  let adjustedWarnings = [...warnings];

  if (
    topScore !== null &&
    secondScore !== null &&
    Math.abs(topScore - secondScore) <= 5
  ) {
    adjustedScore -= 25;
    adjustedWarnings.push('Top match is too close to another candidate');
  }

  adjustedScore = clamp(adjustedScore, 0, 100);

  const confidence = Number((adjustedScore / 100).toFixed(2));
  const label = getConfidenceLabel(adjustedScore);
  const fallbackUsed = label === 'low';

  return {
    matchScore: adjustedScore,
    matchConfidence: confidence,
    confidenceLabel: label,
    matchReason: buildReasonSummary(reasons, adjustedWarnings, label),
    fallbackUsed,
  };
}

module.exports = {
  buildConfidenceResult,
};