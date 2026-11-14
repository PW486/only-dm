#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SET_VERSION = join(ROOT, "scripts", "set-version.mjs");
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    ...options,
  });
}

function capture(command, args) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
}

function git(...args) {
  return run("git", args);
}

function main() {
  const args = process.argv.slice(2);
  const noPush = args.includes("--no-push");
  const version = args.find((arg) => !arg.startsWith("--"))?.replace(/^v/, "");

  if (!version || !SEMVER.test(version)) {
    console.error("Usage: npm run release -- <version> [--no-push]");
    console.error("Example: npm run release -- 0.2.0");
    process.exit(1);
  }

  const tag = `v${version}`;

  const status = capture("git", ["status", "--porcelain"]);
  if (status) {
    console.error("Working tree is not clean. Commit or stash changes first:\n");
    console.error(status);
    process.exit(1);
  }

  const branch = capture("git", ["branch", "--show-current"]);
  if (branch !== "main") {
    console.error(`Releases must be created from main (current: ${branch}).`);
    process.exit(1);
  }

  git("fetch", "origin", "main");
  const behind = Number(
    capture("git", ["rev-list", "--count", "HEAD..origin/main"]),
  );
  if (behind > 0) {
    console.error(
      `Local main is ${behind} commit(s) behind origin/main. Pull before releasing.`,
    );
    process.exit(1);
  }

  if (capture("git", ["tag", "-l", tag])) {
    console.error(`Tag ${tag} already exists.`);
    process.exit(1);
  }

  run(process.execPath, [SET_VERSION, version]);

  git("add", "-A");
  git("commit", "-m", `chore(release): ${tag}`);
  git("tag", "-a", tag, "-m", `OnlyDM ${tag}`);

  if (noPush) {
    console.log(`\nCreated commit and ${tag}. Push with:`);
    console.log("  git push origin main");
    console.log(`  git push origin ${tag}`);
  } else {
    git("push", "origin", "main");
    git("push", "origin", tag);
    console.log(`\nPushed ${tag}. The release workflow will build all platforms.`);
  }
}

try {
  main();
} catch (error) {
  console.error(`\nRelease failed: ${error.message}`);
  process.exit(1);
}
