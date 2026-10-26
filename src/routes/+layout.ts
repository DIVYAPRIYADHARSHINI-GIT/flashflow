// FlashFlow is a browser-only app: all data lives in this browser's localStorage, so there
// is nothing for a server to render. Disabling SSR avoids a hydration mismatch between the
// empty server render and the real local data, and keeps every page instant after load.
// The ONLY server code in the project is the PDF route under /api/pdf.
export const ssr = false;
export const prerender = false;
