# 7 Day Food Planner

A React + TypeScript web app for tracking cupboard, fridge, and freezer items, capturing products by barcode, and generating a seven-day meal plan that respects family dietary requirements.

## What it does

- Tracks inventory by storage zone.
- Saves inventory and family dietary data in local browser storage.
- Looks up product metadata from the [Open Food Facts API](https://world.openfoodfacts.org/data).
- Supports browser-based barcode scanning with the `BarcodeDetector` API when the browser exposes it.
- Builds a seven-day meal plan from available ingredients and filters recipes against dietary tags and ingredient avoidances.
- Shows recipe health information including calories, protein, fibre, and sodium.

## Running locally

```bash
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

## Build and lint

```bash
npm run lint
npm run build
```

## Notes

- Barcode camera scanning depends on browser support for `BarcodeDetector`. If it is unavailable, manual barcode entry still works.
- Product metadata comes from Open Food Facts. Coverage varies by barcode and market.
- The meal planner currently uses an in-app recipe library and scores recipes based on ingredient coverage plus simple nutrition weighting.

## Next useful extensions

- User accounts and shared household sync.
- Editable recipe library or integration with a recipe API.
- Shopping list generation from missing ingredients.
- Expiry-first planning and waste reduction rules.
