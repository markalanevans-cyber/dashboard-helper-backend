require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/* ------------------ ROOT ------------------ */
app.get('/', (req, res) => {
  res.send('Dashboard Helper backend is running');
});

/* ------------------ VEHICLE LOOKUP ------------------ */
app.get('/vehicle', async (req, res) => {
  const registration = (req.query.registration || '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

  if (!registration) {
    return res.status(400).json({
      error: 'Missing registration query parameter',
    });
  }

  const dvlaApiKey = (process.env.DVLA_API_KEY || '').trim();

  if (!dvlaApiKey) {
    return res.status(500).json({
      error: 'DVLA_API_KEY is missing from the environment',
    });
  }

  try {
    const dvlaResponse = await fetch(
      'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles',
      {
        method: 'POST',
        headers: {
          'x-api-key': dvlaApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          registrationNumber: registration,
        }),
      }
    );

    const rawText = await dvlaResponse.text();

    let dvlaData = {};
    try {
      dvlaData = rawText ? JSON.parse(rawText) : {};
    } catch (_) {
      dvlaData = {};
    }

    if (!dvlaResponse.ok) {
      return res.status(dvlaResponse.status).json({
        error: 'DVLA lookup failed',
        status: dvlaResponse.status,
        details: dvlaData,
      });
    }

    // ✅ SAFE MODEL HANDLING
    const model =
      dvlaData.model && dvlaData.model.trim() !== ''
        ? dvlaData.model
        : 'Model unavailable';

    return res.json({
      registration: dvlaData.registrationNumber || registration,
      make: dvlaData.make || '',
      model: model,
      colour: dvlaData.colour || '',
      fuelType: dvlaData.fuelType || '',
      yearOfManufacture: dvlaData.yearOfManufacture || '',
      engineCapacity: dvlaData.engineCapacity || '',
      co2Emissions: dvlaData.co2Emissions || '',
      euroStatus: dvlaData.euroStatus || '',
      typeApproval: dvlaData.typeApproval || '',
      wheelplan: dvlaData.wheelplan || '',
      revenueWeight: dvlaData.revenueWeight || '',
      taxStatus: dvlaData.taxStatus || '',
      taxDueDate: dvlaData.taxDueDate || '',
      motStatus: dvlaData.motStatus || '',
      motExpiryDate: dvlaData.motExpiryDate || '',
      ulezStatus: '',
      raw: dvlaData,
    });
  } catch (error) {
    console.error('Vehicle lookup failed:', error);

    return res.status(500).json({
      error: 'Vehicle lookup failed',
      details: error.message,
    });
  }
});

/* ------------------ TYRE PRESSURE ------------------ */
app.get('/tyre-pressure', (req, res) => {
  const registration = (req.query.registration || '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

  if (!registration) {
    return res.status(400).json({
      error: 'Missing registration query parameter',
    });
  }

  return res.json({
    registration,
    vehicleLabel: registration,

    // ✅ HONEST DATA (NO FAKE PSI)
    frontPsi: 'Check vehicle label',
    rearPsi: 'Check vehicle label',
    frontBar: 'Door sticker / handbook',
    rearBar: 'Door sticker / handbook',

    loadNote:
      'Vehicle-specific tyre pressures are not yet available. Check the driver door-jamb sticker, fuel flap label, or vehicle handbook for correct values.',

    source: 'Manual guidance',
  });
});

/* ------------------ START SERVER ------------------ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});