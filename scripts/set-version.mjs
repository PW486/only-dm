#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const files = {
  packageJson: join(ROOT, "package.json"),
  packageLock: join(ROOT, "package-lock.json"),
  tauriConf: join(ROOT, "src-tauri", "tauri.conf.json"),
  cargoToml: join(ROOT, "src-tauri", "Cargo.toml"),
  cargoLock: join(ROOT, "src-tauri", "Cargo.lock"),
  infoPlist: join(ROOT, "src-tauri", "Info.plist"),
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function writeText(path, value) {
  writeFileSync(path, value);
}

function setCargoPackageVersion(text, version) {
  const lines = text.split("\n");
  let inPackage = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith("[")) {
      inPackage = line === "[package]";
    }
    if (inPackage && /^version\s*=/.test(line)) {
      lines[i] = `version = "${version}"`;
      return lines.join("\n");
    }
  }

  throw new Error("Could not find [package] version in src-tauri/Cargo.toml");
}

function getCargoPackageVersion(text) {
  const lines = text.split("\n");
  let inPackage = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inPackage = trimmed === "[package]";
    }
    if (inPackage) {
      const match = trimmed.match(/^version\s*=\s*"([^"]+)"/);
      if (match) {
        return match[1];
      }
    }
  }

  throw new Error("Could not find [package] version in src-tauri/Cargo.toml");
}

function getCargoLockVersion(text) {
  const match = text.match(
    /\[\[package\]\]\nname = "only-dm"\nversion = "([^"]+)"/,
  );
  if (!match) {
    throw new Error("Could not find only-dm package in src-tauri/Cargo.lock");
  }
  return match[1];
}

function setCargoLockVersion(text, version) {
  const updated = text.replace(
    /(\[\[package\]\]\nname = "only-dm"\nversion = ")[^"]+(")/,
    `$1${version}$2`,
  );

  if (updated === text) {
    throw new Error("Could not update only-dm package in src-tauri/Cargo.lock");
  }
  return updated;
}

function getInfoPlistVersion(text) {
  const match = text.match(
    /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
  );
  return match?.[1];
}

function setInfoPlistVersion(text, version) {
  if (!getInfoPlistVersion(text)) {
    return text;
  }
  return text.replace(
    /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/,
    `$1${version}$2`,
  );
}

export function collectVersions() {
  const packageJson = readJson(files.packageJson);
  const packageLock = readJson(files.packageLock);
  const tauriConf = readJson(files.tauriConf);
  const cargoToml = readText(files.cargoToml);
  const cargoLock = readText(files.cargoLock);
  const infoPlist = readText(files.infoPlist);

  return {
    packageJson: packageJson.version,
    packageLockRoot: packageLock.version,
    packageLockPackage: packageLock.packages?.[""]?.version,
    tauriConf: tauriConf.version,
    cargoToml: getCargoPackageVersion(cargoToml),
    cargoLock: getCargoLockVersion(cargoLock),
    infoPlist: getInfoPlistVersion(infoPlist),
    bundleVersion: tauriConf.bundle?.macOS?.bundleVersion,
  };
}

export function assertVersions(expectedVersion) {
  const versions = collectVersions();
  const entries = [
    ["package.json", versions.packageJson],
    ["package-lock.json (root)", versions.packageLockRoot],
    ['package-lock.json (packages[""])', versions.packageLockPackage],
    ["tauri.conf.json", versions.tauriConf],
    ["Cargo.toml", versions.cargoToml],
    ["Cargo.lock", versions.cargoLock],
    ...(versions.infoPlist
      ? [["Info.plist", versions.infoPlist]]
      : []),
  ];

  const expected = (expectedVersion ?? versions.packageJson).replace(/^v/, "");
  let failed = false;

  for (const [name, value] of entries) {
    const ok = value === expected;
    if (!ok) {
      failed = true;
    }
    console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${value ?? "(missing)"}`);
  }

  console.log(`\nExpected version: ${expected}`);
  if (failed) {
    throw new Error("Version files are out of sync");
  }
}

export function setVersion(version) {
  const cleanVersion = version.replace(/^v/, "");
  if (!SEMVER.test(cleanVersion)) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  const packageJson = readJson(files.packageJson);
  const packageLock = readJson(files.packageLock);
  const tauriConf = readJson(files.tauriConf);
  const cargoToml = readText(files.cargoToml);
  const cargoLock = readText(files.cargoLock);
  const infoPlist = readText(files.infoPlist);

  const previousVersion = tauriConf.version;
  const previousBuild = Number(tauriConf.bundle?.macOS?.bundleVersion ?? 0);

  packageJson.version = cleanVersion;
  writeJson(files.packageJson, packageJson);

  packageLock.version = cleanVersion;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = cleanVersion;
  }
  writeJson(files.packageLock, packageLock);

  tauriConf.version = cleanVersion;
  if (tauriConf.bundle?.macOS) {
    tauriConf.bundle.macOS.bundleVersion = String(
      Number.isFinite(previousBuild) ? previousBuild + 1 : 1,
    );
  }
  writeJson(files.tauriConf, tauriConf);

  writeText(files.cargoToml, setCargoPackageVersion(cargoToml, cleanVersion));
  writeText(files.cargoLock, setCargoLockVersion(cargoLock, cleanVersion));
  writeText(files.infoPlist, setInfoPlistVersion(infoPlist, cleanVersion));

  console.log(
    `Version updated: ${previousVersion} -> ${cleanVersion} ` +
      `(macOS build ${tauriConf.bundle?.macOS?.bundleVersion ?? "unchanged"})`,
  );

  assertVersions(cleanVersion);
}

function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes("--check");
  const version = args.find((arg) => !arg.startsWith("--"));

  try {
    if (checkMode) {
      assertVersions(version);
    } else if (version) {
      setVersion(version);
    } else {
      console.error("Usage:");
      console.error("  node scripts/set-version.mjs <version>");
      console.error("  node scripts/set-version.mjs --check [expected-version]");
      process.exit(1);
    }
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
