#!/usr/bin/env node
/*
 * Verifies that the language-independent icon signatures in inject.js still
 * match the real Instagram SVG geometry archived in
 * scripts/fixtures/instagram-icons.json.
 *
 * When Instagram changes an icon path, update the fixture from the new
 * component definition and adjust ICON_PATH_SIGNATURES if necessary.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractLiteral } from "./lib/source-literals.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const injectSource = readFileSync(
  join(root, "src-tauri", "scripts", "inject.js"),
  "utf8"
);
const fixtures = JSON.parse(
  readFileSync(join(root, "scripts", "fixtures", "instagram-icons.json"), "utf8")
);

const signatures = extractLiteral(injectSource, "ICON_PATH_SIGNATURES");
const fixtureIcons = fixtures.icons;
const errors = [];

const signatureNames = Object.keys(signatures).sort();
const fixtureNames = Object.keys(fixtureIcons).sort();

if (signatureNames.join(",") !== fixtureNames.join(",")) {
  errors.push(
    `Icon sets differ. Code: ${signatureNames.join(", ")} / ` +
      `fixtures: ${fixtureNames.join(", ")}`
  );
}

for (const [name, signature] of Object.entries(signatures)) {
  const fixture = fixtureIcons[name];
  if (!fixture) continue;

  const paths = Array.isArray(fixture.paths) ? fixture.paths : [];
  const matches = paths.filter((path) => path.includes(signature));

  if (matches.length === 0) {
    errors.push(
      `ICON_PATH_SIGNATURES.${name} ("${signature}") is not present in the ` +
        `${fixture.component} fixture`
    );
  }

  if (matches.length > 1) {
    errors.push(
      `ICON_PATH_SIGNATURES.${name} is ambiguous: it matches ` +
        `${matches.length} paths in the fixture`
    );
  }
}

const seen = new Map();
for (const [name, signature] of Object.entries(signatures)) {
  if (seen.has(signature)) {
    errors.push(`ICON_PATH_SIGNATURES.${name} duplicates ${seen.get(signature)}`);
  } else {
    seen.set(signature, name);
  }
}

// `:has()` is only a CSS progressive enhancement: older WKWebView versions
// (macOS 11/12) throw when it appears in querySelector/querySelectorAll.
if (injectSource.includes("svg:has(")) {
  errors.push(
    "inject.js uses svg:has() in a JS selector; use path[d*=...] + closest('svg') instead"
  );
}

if (errors.length) {
  console.error(`Icon fixture check failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `Icon fixture check passed: ${signatureNames.length} signatures match ` +
    `Instagram's archived SVG geometry.`
);
