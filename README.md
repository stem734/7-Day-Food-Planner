# Food Planner

A React + TypeScript web app for tracking cupboard, fridge, and freezer items, capturing products by barcode, generating a seven-day meal plan, and turning missing ingredients into a shopping list.

## Features

- Track inventory by storage zone.
- Save inventory and family dietary rules in local browser storage.
- Look up product metadata from the Open Food Facts API.
- Scan barcodes in supported browsers with `BarcodeDetector`.
- Generate a seven-day meal plan from current inventory.
- Show dietary tags and health information for each recipe.
- Build a shopping list from missing ingredients across the weekly plan.
- Support optional email/password auth and cloud sync with Supabase.

## Run locally

```bash
npm install
npm run dev
```

## Verify

```bash
npm run lint
npm run build
```

## Cloud sync and backup

1. Create a Supabase project.
2. Copy `.env.example` to `.env`.
3. Add your Supabase project values:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

4. Run the SQL in [supabase-schema.sql](/Users/steve/Downloads/7%20Day%20Food%20Planner/supabase-schema.sql) in the Supabase SQL editor.
5. Start the app, create an account, and sign in.

This creates a `planner_state` table keyed by the authenticated user and applies row-level security so each user can access only their own planner data.

Backup behavior:

- Without Supabase, data is stored only in the current browser via local storage.
- With Supabase enabled, inventory, family members, household requirements, and cooked meal status are backed up to the signed-in account.

## Notes

- If Supabase env vars are not present, the app stays fully functional in local-only mode.
- Open Food Facts product coverage varies by barcode and region.
- Camera barcode scanning depends on browser support for `BarcodeDetector`.

## Deployment

This repo is ready for Vercel preview deploys. The production build is static, so no server runtime is required.
