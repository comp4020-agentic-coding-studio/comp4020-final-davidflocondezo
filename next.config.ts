import type { NextConfig } from "next";

// standalone output is what the Dockerfile copies into the runner stage —
// it bundles only the dependencies the server actually needs.
const config: NextConfig = {
  output: "standalone",
  // mqtt (lib/lightning.ts) is missed by standalone's default file-tracing:
  // confirmed by inspecting .next/standalone/node_modules after a real
  // build, which never contains it despite mqtt.connect() being a real
  // runtime call. This tells the tracer to treat it (and its own
  // dependency tree — ws, mqtt-packet, etc.) as an external runtime
  // dependency and copy the whole resolved package tree into standalone's
  // output instead of trying to bundle/trace through it.
  serverExternalPackages: ["mqtt"],
};

export default config;
