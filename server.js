require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { matchTyrePressure } = require('./services/tyreMatcher');
const { buildConfidenceResult } = require('./services/confidence');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let tyreDatabase = [];

try {
  const tyreDataPath = path.join(__dirname, 'tyreData.json');
  if (fs.existsSync(tyreDataPath)) {
    tyreDatabase = JSON.parse(fs.readFileSync(tyreDataPath, 'utf8'));
  }
} catch (error) {
  console.error('Failed to load tyre database:', error.message);
}

function normalizeRegistration(value) {
  return (value || '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function getRegistrationFromRequest(req) {
  return normalizeRegistration(
    req.query.registration ||
      req.body.registration ||
      req.body.registrationNumber ||
      ''
  );
}

function safeValue(value, fallback = 'Unknown') {
  const text = (value ?? '').toString().trim();
  return text === '' ? fallback : text;
}

function normalizeMake(value) {
  return safeValue(value, '').toUpperCase();
}

function normalizeModel(value) {
  return safeValue(value, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function looksLikeVan(vehicle) {
  const wheelplan = safeValue(vehicle.wheelplan, '').toUpperCase();
  const revenueWeight = toNumber(vehicle.revenueWeight);
  const engineCapacity = toNumber(vehicle.engineCapacity);
  const make = normalizeMake(vehicle.make);

  if (wheelplan.includes('LIGHT VAN')) return true;
  if (wheelplan.includes('RIGID BODY')) return true;
  if (revenueWeight !== null && revenueWeight >= 2000) return true;
  if (make === 'FORD' && engineCapacity !== null && engineCapacity >= 1800) {
    return true;
  }

  return false;
}

async function fetchDvlaVehicle(registration) {
  const apiKey = (process.env.DVLA_API_KEY || '').trim();

  if (!apiKey) {
    const error = new Error('DVLA_API_KEY is missing from the environment');
    error.statusCode = 500;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles',
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          registrationNumber: registration,
        }),
        signal: controller.signal,
      }
    );

    const rawText = await response.text();

    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (_) {
      data = {};
    }

    if (!response.ok) {
      const error = new Error('DVLA lookup failed');
      error.statusCode = response.status;
      error.details = data;
      throw error;
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function mapVehicleResponse(registration, dvlaData) {
  const year =
    safeValue(dvlaData.yearOfManufacture, '') ||
    (safeValue(dvlaData.monthOfFirstRegistration, '').length >= 4
      ? safeValue(dvlaData.monthOfFirstRegistration, '').substring(0, 4)
      : 'Unknown');

  return {
    registration: safeValue(dvlaData.registrationNumber, registration),
    make: safeValue(dvlaData.make),
    model: safeValue(dvlaData.model, 'Model unavailable'),
    yearOfManufacture: year,
    fuelType: safeValue(dvlaData.fuelType),
    engineCapacity: safeValue(dvlaData.engineCapacity),
    motStatus: safeValue(dvlaData.motStatus),
    motExpiryDate: safeValue(dvlaData.motExpiryDate),
    taxStatus: safeValue(dvlaData.taxStatus),
    taxDueDate: safeValue(dvlaData.taxDueDate),
    colour: safeValue(dvlaData.colour),
    wheelplan: safeValue(dvlaData.wheelplan, ''),
    revenueWeight: safeValue(dvlaData.revenueWeight, ''),
  };
}

function scoreCandidate(vehicle, item) {
  let score = 0;
  const year = parseInt(vehicle.yearOfManufacture, 10);
  const make = normalizeMake(vehicle.make);
  const model = normalizeModel(vehicle.model);

  if (normalizeMake(item.make) !== make) return -1;

  if (!Number.isNaN(year)) {
    if (year >= Number(item.yearFrom || 0) && year <= Number(item.yearTo || 9999)) {
      score += 5;
    } else {
      return -1;
    }
  }

  if (model && model !== 'MODEL UNAVAILABLE' && normalizeModel(item.model) === model) {
    score += 100;
  }

  const vanLike = looksLikeVan(vehicle);
  const itemModel = normalizeModel(item.model);

  if (vanLike) {
    if (itemModel.includes('TRANSIT CUSTOM')) score += 30;
    if (itemModel === 'TRANSIT') score += 25;
    if (itemModel.includes('TRANSIT CONNECT')) score += 20;
    if (itemModel.includes('FIESTA') || itemModel.includes('FOCUS')) score -= 20;
  } else {
    if (itemModel.includes('FIESTA') || itemModel.includes('FOCUS')) score += 10;
    if (itemModel.includes('TRANSIT')) score -= 15;
  }

  const revenueWeight = toNumber(vehicle.revenueWeight);
  if (revenueWeight !== null) {
    if (revenueWeight >= 2500 && itemModel === 'TRANSIT') score += 20;
    if (revenueWeight >= 2000 && itemModel.includes('TRANSIT CUSTOM')) score += 15;
    if (revenueWeight < 2000 && itemModel.includes('TRANSIT CONNECT')) score += 15;
  }

  const engineCapacity = toNumber(vehicle.engineCapacity);
  if (engineCapacity !== null) {
    if (engineCapacity >= 1900 && itemModel === 'TRANSIT') score += 10;
    if (
      engineCapacity >= 1500 &&
      engineCapacity < 1900 &&
      itemModel.includes('TRANSIT CUSTOM')
    ) {
      score += 8;
    }
    if (engineCapacity <= 1600 && itemModel.includes('TRANSIT CONNECT')) {
      score += 8;
    }
  }

  return score;
}

function findTyreMatch(vehicle) {
  const candidates = tyreDatabase
    .map((item) => ({ item, score: scoreCandidate(vehicle, item) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return null;

  if (candidates.length === 1) return candidates[0].item;

  const best = candidates[0];
  const second = candidates[1];

  if (best.score >= second.score + 10) {
    return best.item;
  }

  return null;
}

function getCandidateScores(vehicle) {
  return tyreDatabase
    .map((item) => ({
      model: item.model,
      make: item.make,
      yearFrom: item.yearFrom,
      yearTo: item.yearTo,
      score: scoreCandidate(vehicle, item),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score);
}

app.get('/', (req, res) => {
  res.send('Dashboard Helper backend is running');
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    tyreDatabaseCount: tyreDatabase.length,
  });
});

async function handleVehicleLookup(req, res) {
  try {
    const registration = getRegistrationFromRequest(req);

    if (!registration) {
      return res.status(400).json({
        error: 'Registration is required',
      });
    }

    const dvlaData = await fetchDvlaVehicle(registration);
    const vehicle = mapVehicleResponse(registration, dvlaData);

    return res.json(vehicle);
  } catch (error) {
    const isTimeout = error.name === 'AbortError';

    console.error('Vehicle lookup failed:', error);

    return res.status(isTimeout ? 504 : error.statusCode || 500).json({
      error: isTimeout ? 'DVLA request timed out' : error.message || 'Lookup failed',
      details: error.details || error.message || 'Unknown error',
    });
  }
}

app.get('/vehicle', handleVehicleLookup);
app.post('/vehicle', handleVehicleLookup);

app.get('/tyre-pressure', async (req, res) => {
  try {
    const registration = getRegistrationFromRequest(req);
    const debug = req.query.debug === 'true';

    if (!registration) {
      return res.status(400).json({
        error: 'Registration is required',
      });
    }

    const dvlaData = await fetchDvlaVehicle(registration);
    const vehicle = mapVehicleResponse(registration, dvlaData);

    const match = matchTyrePressure(vehicle, debug);

    const confidence = buildConfidenceResult({
    score: match.score,
    reasons: match.reasons,
    warnings: match.warnings,
    topScore: match.topScore,
    secondScore: match.secondScore,
});

    return res.json({
    registration,
    vehicle,
    matchedVehicle: match.matchedVehicle,
    tyrePressure: confidence.fallbackUsed ? null : match.tyrePressure,
    estimatedTyrePressure: confidence.fallbackUsed ? match.tyrePressure : null,
    matchScore: confidence.matchScore,
    matchConfidence: confidence.matchConfidence,
    confidenceLabel: confidence.confidenceLabel,
    matchReason: confidence.matchReason,
    fallbackUsed: confidence.fallbackUsed,
    needsModelSelection: match.needsModelSelection,
    modelOptions: match.modelOptions,
    verificationHint:
    'Check the driver door frame, fuel flap, or owner manual to confirm.',
    warnings: match.warnings,
    debug: debug ? match.debug : undefined,
});
  } catch (error) {
    const isTimeout = error.name === 'AbortError';

    console.error('Tyre pressure lookup failed:', error);

    return res.status(isTimeout ? 504 : error.statusCode || 500).json({
      error: isTimeout
        ? 'DVLA request timed out'
        : error.message || 'Tyre lookup failed',
      details: error.details || error.message || 'Unknown error',
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});