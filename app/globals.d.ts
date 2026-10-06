// Side-effect CSS imports (e.g. "leaflet/dist/leaflet.css") aren't typed by
// Next's own shipped types — Next's webpack config handles them at build
// time, but tsc still wants an ambient declaration to type-check the import.
declare module "*.css";
