## Version

**V2** — current GitHub Pages/static build.

# PMG Intake App V2

This is the simple **GitHub-ready static version** of the PMG Intake App vehicle preparation app.

It does **not use Next.js**.

## Files

- `index.html` — main app
- `style.css` — dark/navy company styling
- `app.js` — app logic, scanner camera and vehicle workflow starter

## GitHub Pages

For GitHub Pages, these files should be in the **root of the repository**.

The important file is:

`index.html`

GitHub Pages will load this at:

`https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`

If this is the root user site repository, it can be:

`https://YOUR-USERNAME.github.io/`

## Current design

- Dark/black interface
- Dark blue company colour
- White/silver generic car silhouette
- 3-second opening splash screen
- Mobile-first layout
- Large enough controls for use on a phone
- Live camera viewfinder
- Does not save camera images
- Registration manual-entry fallback
- Vehicle records stored locally in the browser for this starter version

## Connecting the real APIs

The vehicle lookup is intentionally separated from the UI.

In `app.js`, set:

```js
const VEHICLE_API_URL = "https://YOUR-CLOUDFLARE-WORKER/api/vehicle";
```

Your Cloudflare Worker should then receive:

```json
{
  "registration": "AB12CDE"
}
```

and securely call your DVLA/DVSA APIs server-side.

Do **not** put DVLA/DVSA API keys in `index.html`, `style.css` or `app.js`.

## ANPR / OCR

The camera currently acts as a live viewfinder. It does not save a photograph.

The next implementation step is to connect an ANPR provider or browser-compatible OCR layer that returns:

```json
{
  "registration": "AB12CDE",
  "confidence": 0.98
}
```

The registration can then be sent to the Cloudflare vehicle API.

## Important

This is the GitHub/static starting version. The intended workflow is: Scan → Inspection → Photos → Work if needed → Location/Ready. Supabase database, user accounts, work assignment and Pitch 1 / Pitch 2 / Road / S6 CAF workflow can be added on top of this structure without changing the basic entry point.


## Stock search and weekly new-stock view

The current GitHub version is built around **new stock first**.

The stock area supports:

- New stock added this week
- All existing stock
- Search by registration
- Search by make and model
- Search by fuel type
- Search by transmission
- Search by colour/year/stage
- Filter by site location
- New-stock count for the current week
- Total stock count
- Location counts for Pitch 1, Pitch 2, Road and S6 CAF
- Additional location options such as Workshop, Photography and Unassigned

The current starter stores vehicle records in browser storage. The production version should move this stock data into Supabase so every team member sees the same live stock list and weekly figures.


## API integration is already scaffolded

The project now includes a **Cloudflare Worker API gateway** so the GitHub Pages frontend does not need to know or contain your DVLA/DVSA secrets.

Files:

- `cloudflare-worker.js` — secure API gateway
- `cloudflare-worker.env.example` — required secret/config names
- `worker-package.json` — Worker deployment commands
- `worker-wrangler.toml` — Worker configuration

### How the live lookup works

`index.html/app.js`
→ Cloudflare Worker `/api/vehicle`
→ DVLA Vehicle Enquiry Service
→ DVSA MOT History API
→ normalised vehicle response
→ app

The current DVLA VES endpoint is `POST /vehicle-enquiry/v1/vehicles`, using the registration in the JSON request body and an `x-api-key` header. citeturn1search6

The current DVSA MOT History API uses the registration endpoint `GET /v1/trade/vehicles/registration/{registration}`. The current authentication flow uses OAuth 2.0 client credentials plus the DVSA API key; the Bearer token and `X-API-Key` are sent to the MOT API. citeturn1search1turn2view1

### What you will need when you connect it

You do **not** need to redesign the application.

You will only need to put your actual credentials/configuration into Cloudflare:

- DVLA API key
- DVSA API key
- DVSA client ID
- DVSA client secret
- DVSA token URL supplied with your DVSA credentials
- DVSA scope if your credentials use a different scope

Then put the public Cloudflare Worker URL into the `VEHICLE_API_URL` constant at the top of `app.js`.

**Never put those secrets into GitHub.**

### If your existing DVSA API is a different approved setup

The Worker deliberately keeps `DVSA_API_URL` and `DVSA_TOKEN_URL` configurable. If your existing credentials use a different endpoint or authentication configuration, those values can be changed without rebuilding the GitHub frontend.

If the exact API credentials you already have use the current DVSA MOT History API, the included Worker is already structured for that authentication flow. citeturn2view1

### Important

The exact credentials themselves are not included in this ZIP. They should remain secrets in Cloudflare. The code is prepared for the connection, but I cannot safely invent your private API key/client credentials.


## Branding

`pmg-logo.png` is the PMG logo used on the 3-second loading screen and the main app header. The checkerboard background from the source logo image has been removed and the logo is rendered as a silver/white mark on the dark interface.
