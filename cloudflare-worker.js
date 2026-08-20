/*
  PMG Intake App - Cloudflare Worker
  Secure vehicle API gateway for the GitHub Pages frontend.

  IMPORTANT:
  - Put all secrets in Cloudflare Worker secrets/environment variables.
  - Never put DVLA/DVSA credentials in index.html or app.js.
  - The GitHub frontend only calls this Worker.
*/

let cachedDvsaToken = null;
let cachedDvsaTokenExpiresAt = 0;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function cleanRegistration(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function getDvsaAccessToken(env) {
  const now = Date.now();
  if (cachedDvsaToken && cachedDvsaTokenExpiresAt > now + 60_000) {
    return cachedDvsaToken;
  }

  if (!env.DVSA_CLIENT_ID || !env.DVSA_CLIENT_SECRET || !env.DVSA_TOKEN_URL || !env.DVSA_SCOPE) {
    throw new Error("DVSA OAuth credentials are not configured in Cloudflare.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.DVSA_CLIENT_ID,
    client_secret: env.DVSA_CLIENT_SECRET,
    scope: env.DVSA_SCOPE,
  });

  const response = await fetch(env.DVSA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`DVSA authentication failed (${response.status}).`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("DVSA authentication returned no access token.");
  }

  const expiresIn = Number(data.expires_in || 3600);
  cachedDvsaToken = data.access_token;
  cachedDvsaTokenExpiresAt = now + Math.max(60, expiresIn - 60) * 1000;

  return cachedDvsaToken;
}

async function lookupDvla(registration, env) {
  const url = env.DVLA_API_URL ||
    "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";

  if (!env.DVLA_API_KEY) {
    throw new Error("DVLA API key is not configured in Cloudflare.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "x-api-key": env.DVLA_API_KEY,
    },
    body: JSON.stringify({ registrationNumber: registration }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.errors?.[0]?.detail || `DVLA lookup failed (${response.status}).`);
  }

  return data;
}

async function lookupDvsa(registration, env) {
  const base = env.DVSA_API_URL || "https://history.mot.api.gov.uk";
  const url = `${base.replace(/\/$/, "")}/v1/trade/vehicles/registration/${encodeURIComponent(registration)}`;
  const token = await getDvsaAccessToken(env);

  if (!env.DVSA_API_KEY) {
    throw new Error("DVSA API key is not configured in Cloudflare.");
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${token}`,
      "X-API-Key": env.DVSA_API_KEY,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(data?.errors?.[0]?.detail || `DVSA MOT lookup failed (${response.status}).`);
  }

  return data;
}

function latestMotExpiry(motData) {
  if (!motData) return null;

  // Prefer an API-provided top-level expiry if present.
  if (motData.motTestDueDate) return motData.motTestDueDate;

  const tests = Array.isArray(motData.motTests) ? motData.motTests : [];
  const passed = tests
    .filter(test => test?.testResult === "PASSED" && test?.expiryDate)
    .sort((a, b) => String(b.completedDate || "").localeCompare(String(a.completedDate || "")));

  return passed[0]?.expiryDate || null;
}

function normaliseVehicle(registration, dvla, dvsa) {
  const motExpiry = latestMotExpiry(dvsa);

  return {
    registration,
    make: dvla?.make || dvsa?.make || "",
    model: dvsa?.model || dvla?.model || "",
    year: dvla?.yearOfManufacture || "",
    colour: dvla?.colour || dvsa?.primaryColour || "",
    fuel_type: dvla?.fuelType || dvsa?.fuelType || "",
    transmission: "",
    engine_capacity: dvla?.engineCapacity || dvsa?.engineSize || "",
    date_first_registered: dvla?.monthOfFirstRegistration || dvsa?.registrationDate || dvsa?.firstUsedDate || "",
    mot_status: dvla?.motStatus || (motExpiry ? "Valid" : "Unknown"),
    mot_expiry: motExpiry,
    tax_status: dvla?.taxStatus || "",
    tax_due_date: dvla?.taxDueDate || "",
    marked_for_export: dvla?.markedForExport,
    vehicle_id: dvsa?.vehicleId || "",
    mot_tests: Array.isArray(dvsa?.motTests) ? dvsa.motTests : [],
    raw_dvla: dvla || null,
    raw_dvsa: dvsa || null,
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "PMG Intake App Vehicle API" });
    }

    if (url.pathname !== "/api/vehicle" || request.method !== "POST") {
      return json({ error: "Not found" }, 404);
    }

    try {
      const body = await request.json();
      const registration = cleanRegistration(body?.registration);

      if (registration.length < 2 || registration.length > 10) {
        return json({ error: "Invalid registration." }, 400);
      }

      // Run both services. DVLA supplies core vehicle/tax data; DVSA supplies MOT history.
      const [dvla, dvsa] = await Promise.all([
        lookupDvla(registration, env),
        lookupDvsa(registration, env),
      ]);

      const vehicle = normaliseVehicle(registration, dvla, dvsa);

      return json({ vehicle });
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : "Vehicle lookup failed.",
      }, 502);
    }
  },
};
