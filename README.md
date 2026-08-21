# PMG Intake App — V3

Professional mobile-first vehicle intake and stock control for Penistone Motor Group.

## Application name

**PMG Intake App**

The GitHub repository and Cloudflare project names remain unchanged:

- GitHub: `PMG-Vehicle-Intake`
- Cloudflare Pages: `pmg-vehicle-intake`

## V3 changes

### Vehicle lookup
- Registration lookup runs through the PMG Vehicle Intake Pages Function at `/api/vehicle`.
- DVLA VES data is mapped when configured.
- DVSA MOT History data is also mapped, including make, model, fuel type, colour, dates, engine size, MOT tests, mileage and defects.
- The app combines the two sources into one vehicle record before showing it.
- Transmission is supported when a connected source returns it; otherwise it is an editable confirmation field.

### New Stock
A lookup no longer silently creates a stock record. It first opens a vehicle preview with **Add to New Stock**.

When the user confirms, the vehicle is stored as New Stock with:
- registration and vehicle identity
- fuel, engine, colour and year
- registration/manufacture dates
- tax and MOT information
- emissions and Euro status where available
- latest MOT mileage
- MOT history and defects/advisories
- inspection/work/photo/location fields for the PMG workflow
- stock-added timestamp for weekly new-stock reporting

Existing V2 local stock data is migrated automatically when the app is first opened in V3.

### Stock search
Search can use registration, make, model, fuel, transmission, colour, year, engine, Euro status, tax status, site location and work destination.

### Work routing
Work destination remains separate from physical site location.

Work destinations:
- Fuad’s/Bodyshop
- S9 MOT
- Pitstop
- KJ Autos
- Steel City
- One Stop MOT
- City Tyres
- A & J

Site locations:
- Pitch 1
- Pitch 2
- Road
- S6 CAF

### OCR / ANPR
- Live camera view only; no camera image is saved by the app.
- 1× / 2× / 3× camera zoom controls.
- Focus control where supported by the device/browser.
- Multiple OCR preprocessing passes and UK registration validation.

## Cloudflare Pages structure

The repository must contain the Pages Functions directory at the root:

```text
PMG-Vehicle-Intake/
├── index.html
├── app.js
├── style.css
├── manifest.webmanifest
├── pmg-logo.png
├── README.md
└── functions/
    └── api/
        ├── vehicle.js
        └── health.js
```

Do not rename `functions`, `api`, `vehicle.js`, or `health.js`.

## Cloudflare secrets

The production Pages Function expects the existing PMG Vehicle Intake credentials in Cloudflare. The relevant names are:

- `DVLA_API_KEY` (optional but recommended for DVLA vehicle/tax data)
- `DVSA_API_KEY`
- `DVSA_CLIENT_ID`
- `DVSA_CLIENT_SECRET`
- `DVSA_TOKEN_URL`
- `DVSA_SCOPE` (optional; defaults to the current DVSA scope used by the function)

Never put the secret values into GitHub files.

## Health check

After deployment, open:

`https://pmg-vehicle-intake.pages.dev/api/health`

It should return a JSON response confirming that PMG Vehicle Intake Pages Functions are running.
