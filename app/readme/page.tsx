import { readFileSync } from "node:fs";
import { marked } from "marked";

// Read at request time, not build time, so editing README.md only needs a
// redeploy, not a rebuild step of its own. spec/invariants.test.ts checks
// every README heading appears here, in order.
export default function ReadmePage() {
  const markdown = readFileSync("README.md", "utf8");
  const html = marked.parse(markdown, { async: false });

  return (
    <main style={{ maxWidth: "70ch", margin: "0 auto", padding: "2rem 1rem" }}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
