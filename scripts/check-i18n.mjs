#!/usr/bin/env node
/*
 * Validates the translation bundles and language-independent icon signatures
 * embedded in src-tauri/scripts/inject.js.
 *
 * The script has no npm dependencies: it extracts the object literals from the
 * injected script and evaluates them in an isolated VM context.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractLiteral } from "./lib/source-literals.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const injectPath = join(root, "src-tauri", "scripts", "inject.js");
const source = readFileSync(injectPath, "utf8");

const EXPECTED_LANGUAGES = [
  "ko",
  "en",
  "ja",
  "zh",
  "zh-tw",
  "zh-hk",
  "es",
  "fr",
  "de",
  "pt",
  "it",
  "ru",
  "vi",
  "th",
  "id",
  "tr",
];

const LOGOUT_FIELDS = [
  "tooltip",
  "title",
  "desc",
  "confirm",
  "loggingOut",
  "cancel",
];

const REQUIRED_ICONS = [
  "compose",
  "audioCall",
  "videoCall",
  "voiceClip",
  "back",
  "accountChevron",
];

const errors = [];

function checkLanguageMap(label, map, fields) {
  const keys = Object.keys(map).sort();
  const expected = [...EXPECTED_LANGUAGES].sort();

  if (keys.join(",") !== expected.join(",")) {
    const missing = expected.filter((lang) => !(lang in map));
    const extra = keys.filter((lang) => !EXPECTED_LANGUAGES.includes(lang));
    if (missing.length) errors.push(`${label}: missing languages: ${missing.join(", ")}`);
    if (extra.length) errors.push(`${label}: unexpected languages: ${extra.join(", ")}`);
  }

  for (const lang of EXPECTED_LANGUAGES) {
    const bundle = map[lang];
    if (!bundle) continue;

    if (typeof bundle === "string") {
      if (!bundle.trim()) errors.push(`${label}.${lang}: empty string`);
      continue;
    }

    if (typeof bundle !== "object" || Array.isArray(bundle)) {
      errors.push(`${label}.${lang}: expected a string or object`);
      continue;
    }

    for (const field of fields) {
      const value = bundle[field];
      if (typeof value !== "string" || !value.trim()) {
        errors.push(`${label}.${lang}.${field}: missing or empty`);
      }
    }

    const extraFields = Object.keys(bundle).filter(
      (field) => !fields.includes(field)
    );
    if (extraFields.length) {
      errors.push(`${label}.${lang}: unexpected fields: ${extraFields.join(", ")}`);
    }
  }
}

const logout = extractLiteral(source, "LOGOUT_I18N");
const back = extractLiteral(source, "BACK_I18N");
const icons = extractLiteral(source, "ICON_PATH_SIGNATURES");
const aliases = extractLiteral(source, "LANGUAGE_ALIASES");
const callLabels = extractLiteral(source, "CALL_AND_VOICE_LABELS");
const composeLabels = extractLiteral(source, "COMPOSE_ARIA_LABELS");

checkLanguageMap("LOGOUT_I18N", logout, LOGOUT_FIELDS);
checkLanguageMap("BACK_I18N", back, []);

for (const [alias, target] of Object.entries(aliases)) {
  if (!(target in logout) || !(target in back)) {
    errors.push(`LANGUAGE_ALIASES.${alias}: unknown target "${target}"`);
  }
}

for (const name of REQUIRED_ICONS) {
  const signature = icons[name];
  if (typeof signature !== "string" || !signature.trim()) {
    errors.push(`ICON_PATH_SIGNATURES.${name}: missing or empty`);
  }
}

const seenSignatures = new Map();
for (const [name, signature] of Object.entries(icons)) {
  if (typeof signature !== "string" || !signature.trim()) continue;
  if (signature.length < 6) {
    errors.push(`ICON_PATH_SIGNATURES.${name}: signature is too short`);
  }
  if (seenSignatures.has(signature)) {
    errors.push(
      `ICON_PATH_SIGNATURES.${name}: duplicates ${seenSignatures.get(signature)}`
    );
  } else {
    seenSignatures.set(signature, name);
  }
}

if (!Array.isArray(callLabels) || callLabels.length === 0) {
  errors.push("CALL_AND_VOICE_LABELS: expected a non-empty array");
} else {
  if (new Set(callLabels).size !== callLabels.length) {
    errors.push("CALL_AND_VOICE_LABELS: contains duplicate labels");
  }
  for (const label of callLabels) {
    if (typeof label !== "string" || !label.trim()) {
      errors.push("CALL_AND_VOICE_LABELS: contains an empty label");
      continue;
    }
    const normalized = label.replace(/\s+/g, " ").trim().toLowerCase();
    if (label !== normalized) {
      errors.push(
        `CALL_AND_VOICE_LABELS: "${label}" must be stored normalized ("${normalized}")`
      );
    }
  }
}

if (!Array.isArray(composeLabels) || composeLabels.length === 0) {
  errors.push("COMPOSE_ARIA_LABELS: expected a non-empty array");
} else {
  for (const selector of composeLabels) {
    if (
      typeof selector !== "string" ||
      !/^svg\[aria-label="[^"]+"\]$/.test(selector)
    ) {
      errors.push(`COMPOSE_ARIA_LABELS: invalid selector "${selector}"`);
    }
  }
}

if (errors.length) {
  console.error(`i18n check failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `i18n check passed: ${EXPECTED_LANGUAGES.length} languages, ` +
    `${LOGOUT_FIELDS.length} logout fields, ${REQUIRED_ICONS.length} icon signatures, ` +
    `${callLabels.length} call/voice labels, ${composeLabels.length} compose labels.`
);
