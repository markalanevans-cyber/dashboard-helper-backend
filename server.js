require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

app.get('/', (req, res) => {
  res.send('Dashboard Helper backend is running');
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
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

app.get('/tyre-pressure', (req, res) => {
  const registration = getRegistrationFromRequest(req);

  if (!registration) {
    return res.status(400).json({
      error: 'Registration is required',
    });
  }

  return res.json({
    registration,
    vehicleLabel: registration,
    frontPsi: 'Check vehicle label',
    rearPsi: 'Check vehicle label',
    frontBar: 'Door sticker / handbook',
    rearBar: 'Door sticker / handbook',
    loadNote:
      'Check the driver door-jamb sticker, fuel flap label, or vehicle handbook for correct tyre pressures.',
    source: 'Manual guidance',
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});