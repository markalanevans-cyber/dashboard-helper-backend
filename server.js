require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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
  return text.isEmpty ? fallback : text;
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
    model: 'Model unavailable',
    yearOfManufacture: year,
    fuelType: safeValue(dvlaData.fuelType),
    engineCapacity: safeValue(dvlaData.engineCapacity),
    motStatus: safeValue(dvlaData.motStatus),
    motExpiryDate: safeValue(dvlaData.motExpiryDate),
    taxStatus: safeValue(dvlaData.taxStatus),
    taxDueDate: safeValue(dvlaData.taxDueDate),
    colour: safeValue(dvlaData.colour),
  };
}

function findTyreMatch(vehicle) {
  const make = normalizeMake(vehicle.make);
  const year = parseInt(vehicle.yearOfManufacture, 10);

  if (!make || Number.isNaN(year)) return null;

  const exactModelCandidates = tyreDatabase.filter((item) => {
    return (
      normalizeMake(item.make) === make &&
      year >= Number(item.yearFrom || 0) &&
      year <= Number(item.yearTo || 9999)
    );
  });

  if (vehicle.model && vehicle.model !== 'Model unavailable') {
    const model = normalizeModel(vehicle.model);
    const exactModel = exactModelCandidates.find(
      (item) => normalizeModel(item.model) === model
    );
    if (exactModel) return exactModel;
  }

  if (exactModelCandidates.length === 1) {
    return exactModelCandidates[0];
  }

  return null;
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

    if (!registration) {
      return res.status(400).json({
        error: 'Registration is required',
      });
    }

    const dvlaData = await fetchDvlaVehicle(registration);
    const vehicle = mapVehicleResponse(registration, dvlaData);
    const tyreMatch = findTyreMatch(vehicle);

    if (tyreMatch) {
      return res.json({
        registration,
        vehicleLabel: `${vehicle.make} ${tyreMatch.model}`.trim(),
        frontPsi: safeValue(tyreMatch.frontPsi),
        rearPsi: safeValue(tyreMatch.rearPsi),
        frontBar: safeValue(tyreMatch.frontBar),
        rearBar: safeValue(tyreMatch.rearBar),
        loadNote: safeValue(
          tyreMatch.loadNote,
          'Check handbook or door label for exact values.'
        ),
        source: safeValue(tyreMatch.source, 'Tyre database'),
      });
    }

    return res.json({
      registration,
      vehicleLabel: vehicle.make,
      frontPsi: 'Check vehicle label',
      rearPsi: 'Check vehicle label',
      frontBar: 'Door sticker / handbook',
      rearBar: 'Door sticker / handbook',
      loadNote:
        'Exact tyre pressures were not found in the database for this vehicle. Check the driver door-jamb sticker, fuel flap label, or vehicle handbook for correct values.',
      source: 'Manual guidance',
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