export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const registration = url.searchParams.get("registration");

  if (!registration) {
    return new Response(
      JSON.stringify({ error: "Registration number is required" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const {
    DVSA_API_KEY,
    DVSA_CLIENT_ID,
    DVSA_CLIENT_SECRET,
    DVSA_SCOPE,
    DVSA_TOKEN_URL
  } = context.env;

  try {
    // Get an OAuth access token from DVSA
    const tokenResponse = await fetch(DVSA_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: DVSA_CLIENT_ID,
        client_secret: DVSA_CLIENT_SECRET,
        scope: DVSA_SCOPE
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();

      return new Response(
        JSON.stringify({
          error: "DVSA authentication failed",
          details: errorText
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const tokenData = await tokenResponse.json();

    // Clean registration number
    const cleanRegistration = registration
      .replace(/\s+/g, "")
      .toUpperCase();

    // Request MOT history
    const motResponse = await fetch(
      `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(cleanRegistration)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
          "X-API-Key": DVSA_API_KEY,
          "Accept": "application/json"
        }
      }
    );

    const responseText = await motResponse.text();

    return new Response(responseText, {
      status: motResponse.status,
      headers: {
        "Content-Type": "application/json"
      }
    });

  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Unable to contact DVSA",
        message: error.message
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
