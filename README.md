# PMG Intake App — V2

Professional mobile-first vehicle intake and stock control for Penistone Motor Group.

**Application-facing name:** PMG Intake App.

**Deployment names:** GitHub repository `PMG-Vehicle-Intake` and Cloudflare Pages project `pmg-vehicle-intake` remain unchanged. Infrastructure names such as `PMG-Vehicle-Intake` and `pmg-vehicle-intake` are intentionally unchanged because they are the existing GitHub/Cloudflare deployment names.

## GitHub / Cloudflare Pages architecture

This build is designed to run **through the existing `PMG-Vehicle-Intake` GitHub repository and its Cloudflare Pages project**. It does not require a separate `pmg-intake-api` Worker.

```text
GitHub: PMG-Vehicle-Intake
        ↓
Cloudflare Pages: pmg-vehicle-intake
        ↓
Pages Function: /api/vehicle
        ↓
DVLA VES + DVSA MOT History API
```

Cloudflare Pages Functions are server-side code deployed with the Pages project. The `/functions` directory at the repository root creates the routes automatically. citeturn0search4turn0search7

## API secrets

Keep credentials in **Cloudflare Pages → Settings → Variables and Secrets**, not in GitHub. Cloudflare supports encrypted secrets for Pages Functions and exposes them to the function through `context.env`. citeturn0search0

Configure these in **Production**:

- `DVLA_API_KEY` — optional if you want DVLA VES vehicle details
- `DVSA_API_KEY`
- `DVSA_CLIENT_ID`
- `DVSA_CLIENT_SECRET`
- `DVSA_TOKEN_URL`
- `DVSA_SCOPE` — normally `https://tapi.dvsa.gov.uk/.default`

The current DVLA VES endpoint is `POST https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles` with an `x-api-key` header and a JSON body containing `registrationNumber`. citeturn1search8turn1search12

The current DVSA MOT History API uses OAuth 2.0 client credentials, a client ID, client secret, scope and token URL, plus the DVSA API key. Vehicle MOT history is requested with `GET /v1/trade/vehicles/registration/{registration}`. citeturn1search0turn1search3

## OCR / camera

The scanner uses the device camera as a **live viewfinder**. It does not save a photograph. OCR temporarily processes a frame in memory and extracts a registration number.

Controls included:

- 1× / 2× / 3× camera zoom
- Hardware zoom through `MediaStreamTrack.applyConstraints()` when supported
- Visual zoom fallback when hardware zoom is unavailable
- Tap-to-focus / continuous focus where the browser exposes the camera capability
- Registration OCR using Tesseract.js
- Manual registration entry fallback

Camera constraints and `applyConstraints()` are standard Media Capture APIs; actual zoom/focus capabilities depend on the device/browser. citeturn0search1turn0search5

## Workflow

1. Scan registration
2. DVLA / DVSA lookup
3. Mechanical inspection
4. Exterior inspection
5. Decide work: MOT / service / garage
6. Photos
7. Assign site location
8. Search and manage stock

## Stock

The UI is built around new stock first and includes search/filtering for:

- Registration
- Make / model
- Fuel type
- Transmission
- Colour / year
- Location
- New stock this week / all stock
- Pitch 1
- Pitch 2
- Road
- S6 CAF
- Workshop / Photography / Unassigned

The current static V2 stores records in browser local storage. For the production multi-user version, move vehicle records to a shared database such as Cloudflare D1 or Supabase.

## GitHub upload

Upload the contents of this ZIP to the **root of `FuegoDinero/PMG-Vehicle-Intake`**. In particular, do not omit:

- `index.html`
- `style.css`
- `app.js`
- `pmg-logo.png`
- `functions/api/vehicle.js`
- `manifest.webmanifest`

The `functions` folder is important: it is what makes `/api/vehicle` run inside the existing PMG Intake App Cloudflare Pages project.

## Work destinations

Cars marked **Work Required** have a separate work-routing field from their physical site location. The **Cars needing attention** section can search by registration/make/model and filter by:

- Fuad’s/Bodyshop
- S9 MOT
- Pitstop
- KJ Autos
- Steel City
- One Stop MOT
- City Tyres
- A & J

This is intentionally separate from the on-site stock locations: **Pitch 1, Pitch 2, Road and S6 CAF**.
