export const NAI_AUTH_ORIGIN =
  "https://auth.usenai.ca";

export const LOCAL_AUTH_ORIGIN = "http://localhost:5173";

export const PANEL_ORIGINS = new Set([
  "https://meet.usenai.ca",
  "http://localhost:5174",
]);

// export function resolveAuthOrigin() {
//   // TODO: swap this with a build-time env value once the extension is packaged.
//   return NAI_AUTH_ORIGIN;
// }

export function resolveAuthOrigin() {
  // TODO: swap this with a build-time env value once the extension is packaged.
  return "http://localhost:5173";
}
