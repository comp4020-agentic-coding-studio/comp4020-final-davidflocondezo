import type { NextConfig } from "next";

// standalone output is what the Dockerfile copies into the runner stage —
// it bundles only the dependencies the server actually needs.
const config: NextConfig = {
  output: "standalone",
};

export default config;
