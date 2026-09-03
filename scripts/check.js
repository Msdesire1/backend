/**
 * Static self-check: does every module in the project parse and resolve, and what
 * routes does the API actually expose?
 *
 *   npm run check
 *
 * No database and no port needed. This catches the two mistakes that are easy to
 * make while a codebase this size is being assembled — a typo in an import path,
 * and a route that was written but never mounted — before a deploy does.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".git", ".claude", "scripts"]);

/** Every .js/.mjs file in the project, excluding dependencies. */
const collect = async (dir) => {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(full)));
    else if (/\.(js|mjs)$/.test(entry.name)) files.push(full);
  }
  return files;
};

const relative = (file) => path.relative(root, file).split(path.sep).join("/");

/* ------------------------------------------------------------------ imports -- */

const files = (await collect(root)).sort();
const failures = [];

for (const file of files) {
  // index.js starts a server and the test files run assertions; importing either
  // here would do far more than check that it parses.
  if (/^(index\.js|tests\/)/.test(relative(file))) continue;
  try {
    await import(pathToFileURL(file).href);
  } catch (error) {
    failures.push([relative(file), error.message]);
  }
}

console.log(`Modules imported: ${files.length - failures.length} ok, ${failures.length} failed`);
for (const [file, message] of failures) console.error(`  FAIL  ${file}\n        ${message}`);
if (failures.length) process.exit(1);

/* ------------------------------------------------------------------- routes -- */

const { mountedRouters } = await import(pathToFileURL(path.join(root, "app.js")).href);

/**
 * Walk a router's layer stack. Express 5 keeps the mount path of a nested router
 * private, so prefixes are threaded down from the mount table rather than read
 * back off the layers.
 */
const walk = (router, prefix, rows) => {
  for (const layer of router?.stack || []) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods)
        .filter((method) => method !== "_all")
        .map((method) => method.toUpperCase())
        .sort();
      const routePath = layer.route.path === "/" ? "" : layer.route.path;
      for (const method of methods) rows.push([method, `${prefix}${routePath}` || "/"]);
    } else if (layer.name === "router" && layer.handle?.stack) {
      walk(layer.handle, prefix, rows);
    }
  }
  return rows;
};

const rows = [["GET", "/api/health"]];
for (const [prefix, router] of mountedRouters) walk(router, prefix, rows);

const width = Math.max(...rows.map(([method]) => method.length));
let group = "";
for (const [method, routePath] of rows) {
  const section = routePath.split("/").slice(0, 3).join("/");
  if (section !== group) {
    group = section;
    console.log("");
  }
  console.log(`  ${method.padEnd(width)}  ${routePath}`);
}

console.log(`\n${rows.length} routes mounted across ${mountedRouters.length} routers.`);
