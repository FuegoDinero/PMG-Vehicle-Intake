const DVLA_URL = 'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles';
const DVSA_URL = 'https://history.mot.api.gov.uk/v1/trade/vehicles/registration/';

let cachedToken = null;
let cachedTokenExpires = 0;

export async function onRequest({ request, env }) {
if (request.method === 'OPTIONS') {
      return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'Method not allowed'
    }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  try {
    const body = await request.json();
    const registration = String(body.registration || body.registrationNumber || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

    if (!registration) {
      return new Response(JSON.stringify({
        error: 'Registration number is required'
      }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (!env.DVLA_API_KEY) {
      return new Response(JSON.stringify({
        error: 'DVLA API key is not configured'
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    const dvlaResponse = await fetch(DVLA_URL, {
      method: 'POST',
      headers: {
        'x-api-key': env.DVLA_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        registrationNumber: registration
      })
    });

    const dvlaText = await dvlaResponse.text();

    let dvlaData;
    try {
      dvlaData = JSON.parse(dvlaText);
    } catch {
      dvlaData = { raw: dvlaText };
    }

    if (!dvlaResponse.ok) {
      return new Response(JSON.stringify({
        error: 'DVLA vehicle lookup failed',
        status: dvlaResponse.status,
        details: dvlaData
      }), {
        status: dvlaResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    let motData = null;

    if (env.DVSA_API_KEY && env.DVSA_CLIENT_ID && env.DVSA_CLIENT_SECRET && env.DVSA_TOKEN_URL) {
      if (!cachedToken || Date.now() >= cachedTokenExpires) {
        const tokenResponse = await fetch(env.DVSA_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: env.DVSA_CLIENT_ID,
            client_secret: env.DVSA_CLIENT_SECRET,
            scope: 'https://tapi.dvsa.gov.uk/.default'
          })
        });

        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json();
          cachedToken = tokenData.access_token;
          cachedTokenExpires =
            Date.now() + ((tokenData.expires_in || 300) - 60) * 1000;
        }
      }

      if (cachedToken) {
        const motResponse = await fetch(
          `${DVSA_URL}${encodeURIComponent(registration)}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${cachedToken}`,
              'X-API-Key': env.DVSA_API_KEY,
              'Accept': 'application/json'
            }
          }
        );

        if (motResponse.ok) {
          motData = await motResponse.json();
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      registration: registration,
      vehicle: dvlaData,
      mot: motData
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Vehicle lookup failed',
      message: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
