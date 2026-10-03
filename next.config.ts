import type { NextConfig } from "next";

/**
 * Static export so the deck can be published to GitHub Pages.
 *
 * `output: "export"` emits a plain `out/` directory — no Node server, no API
 * routes. That is a real trade, and the app is written to survive it:
 *
 *  - Persistence already treats localStorage as the source of truth
 *    (`src/lib/persist.ts`), and the Postgres backup is best-effort with every
 *    failure swallowed. So calibration and progress persist with no backend.
 *  - The API routes (`/api/state`, `/api/voice`, `/api/speak`, `/api/health`)
 *    cannot run on static hosting. They degrade:
 *      * /api/state  -> already a swallowed best-effort backup; no behaviour lost.
 *      * /api/voice  -> voice_pick.py is a LOCAL tool. The browser cannot spawn a
 *                      process, so voice needs the local server (npm run dev) or a
 *                      deployed function. The UI reports this rather than hanging.
 *      * /api/speak  -> narration degrades to silent; motion is unaffected, because
 *                      narration was never on the actuation path.
 *      * /api/health -> informational only.
 *
 * Everything that matters for a live demo — Sim Lab, missions, the virtual arm,
 * single-pick, camera calibration, Web Serial — runs entirely in the browser.
 *
 * `basePath`/`assetPrefix` make the build work under a project-pages URL
 * (https://<user>.github.io/<repo>/). Set NEXT_PUBLIC_BASE_PATH="" for a custom
 * domain or for local verification of the export.
 */
const repo = process.env.NEXT_PUBLIC_REPO ?? "so101-domain-operator";
// Root of the deployed site. For a user/org page (github.io/<user>.repo>) this is "/".
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? `/${repo}`;

/**
 * Static export is OPT-IN (STATIC_EXPORT=1) rather than always-on.
 *
 * `output: "export"` refuses to coexist with the API routes: Next errors on
 * `dynamic = "force-dynamic"` because a static host cannot run a server function.
 * Making it unconditional broke the normal `npm run build`, which is the gate the
 * rest of this project verifies.
 *
 * So: Pages builds set STATIC_EXPORT=1 and drop the routes; local dev and the
 * default build keep them and keep voice working.
 */
const isStatic = process.env.STATIC_EXPORT === "1";

/**
 * basePath must match where GitHub Pages actually SERVES the files.
 *
 * A project site is served at https://<user>.github.io/<repo>/ — NOT at the
 * hostname root. Verified 2026-10-03 against the live deployment: with an empty
 * basePath the exported HTML requested /_next/static/chunks/*.js at the domain
 * root and every chunk 404'd, giving a white page with only the server-rendered
 * text and a few tab labels. Pages resolves the published directory relative to
 * the repo path, so basePath must include it.
 *
 * Next rejects "/" outright ("basePath has to be either an empty string or a path
 * prefix"), hence the normalisation below.
 */
const rawBase = process.env.NEXT_PUBLIC_BASE_PATH ?? basePath;
const applyBase = isStatic && rawBase && rawBase !== "/" ? rawBase : undefined;

const nextConfig: NextConfig = {
  ...(isStatic ? { output: "export" as const, trailingSlash: true, images: { unoptimized: true } } : {}),
  ...(applyBase ? { basePath: applyBase, assetPrefix: applyBase } : {}),
};

export default nextConfig;