const DVLA_URL = 'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles';
const DVSA_URL = 'https://history.mot.api.gov.uk/v1/trade/vehicles/registration/';

let cachedToken = null;
let cachedTokenExpires = 0;

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin') || '') });
  }
  if (request.method !== 'POST') {
    return json({ message: 'PMG Vehicle Intake API is live. Use POST /api/vehicle for vehicle lookups.' }, 405, request.headers.get('Origin') || '', { allow: 'POST, OPTIONS' });
  }

  const origin = request.headers.get('Origin') || '';
  try {
    const body = await request.json();
    const registration = cleanRegistration(body.registration);

    if (!registration || registration.length < 5 || registration.length > 8) {
      return json({ message: 'Please provide a valid UK vehicle registration.' }, 400, origin);
    }

    const result = {
      registration,
      dvla: null,
      mot: null,
      sources: [],
      warnings: []
    };

    // DVLA VES: optional but useful for make/model/fuel/transmission/colour.
    if (env.DVLA_API_KEY) {
      const dvlaResponse = await fetch(DVLA_URL, {
        method: 'POST',
        headers: {
          'x-api-key': env.DVLA_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ registrationNumber: registration })
      });
      const dvlaText = await dvlaResponse.text();
      if (dvlaResponse.ok) {
        result.dvla = safeJson(dvlaText);
        result.sources.push('DVLA');
      } else {
        result.warnings.push(`DVLA returned ${dvlaResponse.status}.`);
      }
    }

    // DVSA MOT History: OAuth client-credentials + X-API-Key.
    const clientId = env.DVSA_CLIENT_ID || env.DVSA_CLIENT;
    const clientSecret = env.DVSA_CLIENT_SECRET || env.DVSA_SECRET;
    const scope = env.DVSA_SCOPE || 'https://tapi.dvsa.gov.uk/.default';
    const tokenUrl = env.DVSA_TOKEN_URL;

    if (env.DVSA_API_KEY && clientId && clientSecret && tokenUrl) {
      try {
        const token = await getDvsaToken({ tokenUrl, clientId, clientSecret, scope });
        const motResponse = await fetch(`${DVSA_URL}${encodeURIComponent(registration)}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-API-Key': env.DVSA_API_KEY,
            'Accept': 'application/json'
          }
        });

        const motText = await motResponse.text();
        if (motResponse.ok) {
          result.mot = safeJson(motText);
          result.sources.push('DVSA MOT History');
        } else {
          return json({
            message: `DVSA vehicle lookup failed (${motResponse.status}).`,
            detail: parseUpstreamError(motText) || 'DVSA rejected the request.',
            upstreamStatus: motResponse.status,
            registration,
            warnings: result.warnings
          }, 502, origin);
        }
      } catch (error) {
        return json({
          message: 'DVSA authentication failed.',
          detail: error.message,
          registration,
          warnings: result.warnings
        }, 502, origin);
      }
    } else {
      result.warnings.push('DVSA credentials are incomplete in PMG Vehicle Intake Cloudflare settings.');
    }

    if (!result.dvla && !result.mot) {
      return json({
        message: 'No vehicle data could be retrieved.',
        detail: 'Check the DVSA/DVLA secrets on the PMG Vehicle Intake Cloudflare Pages production deployment.',
        registration,
        warnings: result.warnings
      }, 502, origin);
    }

    return json(result, 200, origin);
  } catch (error) {
    return json({
      message: 'PMG Vehicle Intake API request failed.',
      detail: error.message
    }, 500, origin);
  }
}

async function getDvsaToken({ tokenUrl, clientId, clientSecret, scope }) {
  if (cachedToken && Date.now() < cachedTokenExpires - 60000) return cachedToken;

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: params.toString()
  });

  const text = await response.text();
  const data = safeJson(text) || {};

  if (!response.ok || !data.access_token) {
    throw new Error(`DVSA token endpoint returned ${response.status}${text ? `: ${parseUpstreamError(text)}` : ''}`);
  }

  cachedToken = data.access_token;
  cachedTokenExpires = Date.now() + Number(data.expires_in || 3600) * 1000;
  return cachedToken;
}

function cleanRegistration(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function parseUpstreamError(text) {
  const data=safeJson(text);
  if(data?.message) return data.message;
  if(data?.error) return typeof data.error==='string'?data.error:JSON.stringify(data.error);
  return String(text||'').slice(0,300);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Cache-Control': 'no-store'
  };
}

function json(data, status, origin, extra={}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      ...extra,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}
