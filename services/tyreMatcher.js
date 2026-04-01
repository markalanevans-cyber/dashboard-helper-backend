const fs = require('fs');
const path = require('path');

const tyreDataPath = path.join(__dirname, '..', 'tyreData.json');
const tyreData = JSON.parse(fs.readFileSync(tyreDataPath, 'utf8'));

function normalizeText(value) {
  return String(value || '').trim().toUpperCase();
}

function parseYearFromDate(dateString) {
  if (!dateString) return null;
  const match = String(dateString).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function detectVan(vehicle) {
  let score = 0;

  if ((vehicle.revenueWeight || 0) > 2000) score += 25;
  if ((vehicle.engineCapacity || 0) > 1800) score += 10;
  if ((vehicle.wheelplan || '').toUpperCase().includes('2 AXLE')) score += 20;

  return score >= 25;
}

function scoreCandidate(candidate, vehicle, year, isVan) {
  let score = 0;
  const reasons = [];
  const warnings = [];

  if (normalizeText(candidate.make) === normalizeText(vehicle.make)) {
    score += 50;
    reasons.push('make matched');
  } else {
    return { score: -999, reasons: [], warnings: ['make mismatch'] };
  }

  if (year && candidate.yearFrom && candidate.yearTo) {
    if (year >= candidate.yearFrom && year <= candidate.yearTo) {
      score += 25;
      reasons.push('year matched');
    } else {
      score -= 15;
      warnings.push('year mismatch');
    }
  } else {
    warnings.push('year unknown');
  }

  const looksVan =
    (candidate.model || '').toUpperCase().includes('TRANSIT') ||
    (candidate.loadNote || '').toUpperCase().includes('VAN');

  if (isVan && looksVan) {
    score += 20;
    reasons.push('van match');
  } else if (isVan && !looksVan) {
    score -= 20;
    warnings.push('vehicle looks like van but match is not');
  }

  if (!vehicle.model || vehicle.model === 'Model unavailable') {
    warnings.push('model missing from DVLA');
  } else if (
    normalizeText(candidate.model) === normalizeText(vehicle.model)
  ) {
    score += 25;
    reasons.push('model matched');
  }

  return { score, reasons, warnings };
}

function buildPressure(candidate) {
  if (!candidate) return null;

  return {
    frontPsi: candidate.frontPsi,
    rearPsi: candidate.rearPsi,
    frontBar: candidate.frontBar,
    rearBar: candidate.rearBar,
    loadNote: candidate.loadNote || null,
    source: candidate.source || null,
  };
}

function buildOption(candidate) {
  return {
    id: `${candidate.make}_${candidate.model}_${candidate.yearFrom}_${candidate.yearTo}`
      .replace(/\s+/g, '_')
      .toUpperCase(),
    label: candidate.model || 'Unknown model',
    frontPsi: candidate.frontPsi,
    rearPsi: candidate.rearPsi,
    frontBar: candidate.frontBar,
    rearBar: candidate.rearBar,
    loadNote: candidate.loadNote || null,
    source: candidate.source || null,
    yearFrom: candidate.yearFrom || null,
    yearTo: candidate.yearTo || null,
  };
}

function matchTyrePressure(vehicle, debug = false) {
  const year =
    Number(vehicle.yearOfManufacture) ||
    parseYearFromDate(vehicle.dateOfFirstRegistration);

  const isVan = detectVan(vehicle);

  const candidates = tyreData
    .filter((t) => normalizeText(t.make) === normalizeText(vehicle.make))
    .map((c) => {
      const result = scoreCandidate(c, vehicle, year, isVan);
      return { candidate: c, ...result };
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    return {
      tyrePressure: null,
      matchedVehicle: null,
      score: 0,
      topScore: 0,
      secondScore: null,
      reasons: [],
      warnings: ['no data for this make'],
      needsModelSelection: false,
      modelOptions: [],
      debug: debug ? [] : undefined,
    };
  }

  const best = candidates[0];
  const second = candidates[1] || null;

  const needsModelSelection =
    candidates.length > 1 &&
    second &&
    Math.abs(best.score - second.score) <= 5;

   return {
  tyrePressure: needsModelSelection ? null : buildPressure(best.candidate),
  matchedVehicle: needsModelSelection
    ? null
    : {
        make: best.candidate.make,
        model: best.candidate.model,
        yearFrom: best.candidate.yearFrom,
        yearTo: best.candidate.yearTo,
      },
  score: best.score,
  topScore: best.score,
  secondScore: second ? second.score : null,
  reasons: best.reasons,
  warnings: best.warnings,
  needsModelSelection,
  modelOptions: needsModelSelection
    ? candidates.slice(0, 3).map((entry) => buildOption(entry.candidate))
    : [],
  debug: debug ? candidates : undefined,
};
}

module.exports = {
  matchTyrePressure,
};