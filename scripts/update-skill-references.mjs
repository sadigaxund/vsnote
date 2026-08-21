#!/usr/bin/env node
/**
 * Vendored skill-reference fetcher — downloads the pinned skill sources listed in
 * `skills/references.config.json` into `skills/references/` (gitignored) so agents
 * read full skill bodies locally instead of re-fetching from the network.
 *
 * Usage:
 *   node scripts/update-skill-references.mjs            # ensure all sources at their PINNED commit
 *   node scripts/update-skill-references.mjs --latest   # re-resolve every source's `ref` to HEAD and update the lock
 *   node scripts/update-skill-references.mjs --source vercel-labs/agent-skills [--latest] [--force]
 *   node scripts/update-skill-references.mjs --list
 *
 * Semantics:
 *  - Pin-by-default: the lock (`skills/references.lock.json`, COMMITTED) stores the
 *    resolved commit sha per source. Without --latest, an up-to-date source is skipped,
 *    so teammates/CI get byte-identical references until someone consciously runs
 *    --latest and commits the lock diff.
 *  - `paths` entries are copied from the extracted tarball into
 *    `<destRoot>/<owner>/<repo>/<path>`; a path of "*" vendors the entire repo root.
 *  - Requires system `tar` (present on Linux/macOS/WSL/git-bash). Uses only Node stdlib
 *    (fetch, zlib not needed — tar handles gzip).
 *  - Per-source failures are reported but don't abort other sources; exit code is 1 if
 *    anything failed. GITHUB_TOKEN (env) is honored for higher API rate limits.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = process.argv.includes("--config")
  ? resolve(process.argv[process.argv.indexOf("--config") + 1])
  : join(ROOT, "skills", "references.config.json");

const FLAGS = new Set(process.argv.filter((a) => a.startsWith("--")));
const LATEST = FLAGS.has("--latest");
const FORCE = FLAGS.has("--force");
const LIST = FLAGS.has("--list");
const ONLY_IDX = process.argv.indexOf("--source");
const ONLY = ONLY_IDX !== -1 ? process.argv[ONLY_IDX + 1] : undefined;

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const DEST_ROOT = join(ROOT, config.destRoot);
const LOCK_PATH = join(ROOT, config.lockFile);
const lock = existsSync(LOCK_PATH) ? JSON.parse(readFileSync(LOCK_PATH, "utf8")) : { sources: {} };

function api(path) {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return fetch(`https://api.github.com${path}`, { headers });
}

async function resolveSha(repo, ref) {
  const res = await api(`/repos/${repo}/commits/${encodeURIComponent(ref)}`);
  if (!res.ok) throw new Error(`resolve ${repo}@${ref}: HTTP ${res.status}`);
  return (await res.json()).sha;
}

async function downloadTarball(repo, sha) {
  const url = `https://codeload.github.com/${repo}/tar.gz/${sha}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tarball ${repo}@${sha.slice(0, 7)}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = join(DEST_ROOT, ".tmp", repo.replace("/", "__") + "-" + sha.slice(0, 7));
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  // Tarball's single root dir is `<repo>-<sha>`; strip it into tmp.
  execFileSync("tar", ["-xzf", "-", "-C", tmp, "--strip-components=1"], { input: buf, maxBuffer: 512 * 1024 * 1024 });
  const entries = readdirSync(tmp);
  if (entries.length === 0) throw new Error(`empty tarball for ${repo}`);
  return tmp;
}

function pathExists(p) {
  return existsSync(p);
}

/** Copies one configured path (file, dir, glob-suffix like LICENSE*, or "*"). */
function copyPath(extracted, relPath, destBase) {
  // Globs are resolved against the extracted root BEFORE any existence check
  // (the literal path never exists — that's the point of the wildcard).
  if (relPath !== "*" && relPath.includes("*")) {
    const sub = dirname(relPath);
    const base = relPath.split("*")[0];
    const scanDir = sub === "." ? extracted : join(extracted, sub);
    if (!pathExists(scanDir)) return false;
    let matched = false;
    for (const name of readdirSync(scanDir)) {
      if (!name.startsWith(base)) continue;
      matched = true;
      mkdirSync(join(destBase, sub), { recursive: true });
      copyFileSync(join(scanDir, name), join(destBase, sub, name));
    }
    return matched;
  }
  const src = relPath === "*" ? extracted : join(extracted, relPath);
  const dest = relPath === "*" ? destBase : join(destBase, relPath);
  if (!pathExists(src)) return false;
  if (statSync(src).isDirectory()) {
    copyDir(src, dest);
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
  return true;
}

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dest, name);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

function dirCount(p) {
  let n = 0;
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const f = join(dir, name);
      if (statSync(f).isDirectory()) walk(f);
      else n += 1;
    }
  })(p);
  return n;
}

if (LIST) {
  for (const s of config.sources) {
    const entry = lock.sources[s.id];
    console.log(`${s.id}  ref=${s.ref}  pinned=${entry?.sha?.slice(0, 7) ?? "—"}  fetched=${entry?.fetchedAt ?? "—"}`);
  }
  process.exit(0);
}

mkdirSync(DEST_ROOT, { recursive: true });
const results = [];
for (const source of config.sources) {
  if (ONLY && source.id !== ONLY) continue;
  const label = source.id;
  try {
    const prev = lock.sources[source.id];
    const sha = LATEST || !prev?.sha ? await resolveSha(source.repo, source.ref) : prev.sha;
    const destBase = join(DEST_ROOT, source.id);
    const fresh = !FORCE && prev?.sha === sha && pathExists(destBase);
    if (fresh && readdirSync(destBase).length > 0) {
      results.push({ label, status: "up-to-date" });
      continue;
    }
    const extracted = await downloadTarball(source.repo, sha);
    rmSync(destBase, { recursive: true, force: true });
    mkdirSync(destBase, { recursive: true });
    let copied = 0;
    for (const p of source.paths) {
      if (!copyPath(extracted, p, destBase)) console.warn(`  ! ${label}: path not found in tarball: ${p}`);
      else copied += 1;
    }
    rmSync(join(DEST_ROOT, ".tmp", `${source.repo.replace("/", "__")}-${sha.slice(0, 7)}`), { recursive: true, force: true });
    lock.sources[source.id] = { ref: source.ref, sha, fetchedAt: new Date().toISOString() };
    const files = pathExists(destBase) ? dirCount(destBase) : 0;
    results.push({ label, status: `fetched (${copied} paths, ${files} files)` });
  } catch (err) {
    results.push({ label, status: `FAILED: ${err.message}` , failed: true });
  }
}

lock.updatedAt = new Date().toISOString();
writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + "\n");

let failed = 0;
for (const r of results) {
  if (r.failed) failed += 1;
  console.log(`${r.failed ? "✖" : "✔"} ${r.label}: ${r.status}`);
}
console.log(`\n${results.length - failed}/${results.length} sources OK → ${config.destRoot} (lock: ${config.lockFile})`);
process.exit(failed ? 1 : 0);
