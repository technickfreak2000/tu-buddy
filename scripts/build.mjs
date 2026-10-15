import {mkdir, readdir, readFile, rm} from "node:fs/promises";
import {resolve, relative} from "node:path";
import {spawnSync} from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "extension");
const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
await mkdir(resolve(root, "dist"), {recursive: true});
const archive = resolve(root, "dist", `tu-berlin-auto-login-${manifest.version}.zip`);
async function files(dir) {
  const all = [];
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) all.push(...await files(path));
    else all.push(relative(source, path));
  }
  return all;
}
// Only ship the explicit extension source tree; no tests, profile data or dev tools.
await rm(archive, {force: true});
const result = spawnSync("zip", ["-q", "-X", archive, ...(await files(source)).sort()], {cwd: source, stdio: "inherit"});
if (result.status !== 0) throw new Error("Could not build archive; install the zip command.");
console.log(`Built ${archive}`);
