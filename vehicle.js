const DVLA_URL = 'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles';
const DVSA_URL = 'https://history.mot.api.gov.uk/v1/trade/vehicles/registration/';

let cachedToken = null;
let cachedTokenExpires = 0;

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  try {
    const body = await request.json();
    const registration = String(body.registration || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!registration || registration.length < 5 || registration.length > 8) {
      return json({ message: 'Please provide a valid UK vehicle registration.' }, 400, origin);
    }

    const result = { registration, dvla: null, mot: null, sources: [], warnings: [] };

    // DVLA VES is optional in the configuration: DVSA can still provide MOT/vehicle data.
    if (env.DVLA_API_KEY) {
      const dvlaResponse = await fetch(DVLA_URL, {
        method: 'POST',
        headers: { 'x-api-key': env.DVLA_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ registrationNumber: registration })
      });
      const dvlaText = await dvlaResponse.text();
      if (dvlaResponse.ok) {
        result.dvla = safeJson(dvlaText);
        result.sources.push('DVLA');
      } else {
        result.warnings.push(`DVLA returned ${dvlaResponse.status}.`);
      }
    } else {
      result.warnings.push('DVLA_API_KEY is not configured in PMG Intake App.');
    }

    if (env.DVSA_API_KEY && env.DVSA_CLIENT_ID && env.DVSA_CLIENT_SECRET && env.DVSA_TOKEN_URL) {
      try {
        const token = await getDvsaToken(env);
        const motResponse = await fetch(`${DVSA_URL}${encodeURIComponent(registration)}`, {
          headers: { 'Authorization': `Bearer ${token}`, 'X-API-Key': env.DVSA_API_KEY, 'Accept': 'application/json' }
        });
        const motText = await motResponse.text();
        if (motResponse.ok) {
          result.mot = safeJson(motText);
          result.sources.push('DVSA MOT History');
        } else {
          result.warnings.push(`DVSA returned ${motResponse.status}.`);
        }
      } catch (error) {
        result.warnings.push(`DVSA authentication failed: ${error.message}`);
      }
    } else {
      result.warnings.push('DVSA credentials are incomplete in PMG Intake App.');
    }

    if (!result.dvla && !result.mot) {
      return json({ message: 'No vehicle data could be retrieved. Check the PMG Intake App API secrets and deployment.', ...result }, 502, origin);
    }

    return json(result, 200, origin);
  } catch (error) {
    return json({ message: 'Vehicle API request failed.', detail: error.message }, 500, origin);
  }
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin') || '') });
}

async function getDvsaToken(env) {
  if (cachedToken && Date.now() < cachedTokenExpires - 60000) return cachedToken;
  const params = new URLSearchParams({ grant_type: 'client_credentials', client_id: env.DVSA_CLIENT_ID, client_secret: env.DVSA_CLIENT_SECRET, scope: env.DVSA_SCOPE || 'https://tapi.dvsa.gov.uk/.default' });
  const response = await fetch(env.DVSA_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, body: params.toString() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`Token endpoint returned ${response.status}`);
  cachedToken = data.access_token;
  cachedTokenExpires = Date.now() + Number(data.expires_in || 3600) * 1000;
  return cachedToken;
}

function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }
function corsHeaders(origin) { return { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' }; }
function json(data, status, origin) { return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' } }); }
