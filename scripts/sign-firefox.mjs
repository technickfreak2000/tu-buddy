import {copyFile, mkdir, mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";

const root = resolve(import.meta.dirname, "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {cwd: root, stdio: "inherit", ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed; no signed installer was produced.`);
  return result;
}

async function main() {
  // Fail before building or contacting Mozilla. Secrets stay out of command arguments.
  if (!process.env.WEB_EXT_API_KEY?.trim() || !process.env.WEB_EXT_API_SECRET?.trim()) {
    throw new Error("Set WEB_EXT_API_KEY (JWT issuer) and WEB_EXT_API_SECRET (JWT secret). " +
      "Create them at https://addons.mozilla.org/developers/addon/api/key/; see INSTALL.md. " +
      "Never commit API credentials.");
  }
  const manifest = JSON.parse(await readFile(resolve(root, "extension/manifest.json"), "utf8"));
  const target = resolve(root, "dist", `tu-buddy-${manifest.version}.xpi`);
  // Do not let a previous successful run look like the result of a failed signing attempt.
  await rm(target, {force: true});
  run(process.execPath, [resolve(root, "scripts/build.mjs")]);
  const staging = await mkdtemp(resolve(tmpdir(), "tu-buddy-sign-"));
  try {
    const source = resolve(staging, "source");
    const artifacts = resolve(staging, "artifacts");
    await mkdir(source);
    await mkdir(artifacts);
    run("unzip", ["-q", resolve(root, "dist", `tu-berlin-auto-login-${manifest.version}.zip`), "-d", source]);
    // Sign only the submission package, never the checkout, profile or local config.
    // web-ext's upload bookkeeping also stays in this temporary directory.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !key.startsWith("WEB_EXT_") || ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"].includes(key)));
    run(process.execPath, [resolve(root, "node_modules/web-ext/bin/web-ext.js"), "sign",
      "--source-dir", source, "--artifacts-dir", artifacts,
      "--channel", "unlisted", "--no-config-discovery",
      "--amo-base-url", "https://addons.mozilla.org/api/v5/",
      "--approval-timeout", "900000"], {env});
    const installers = (await readdir(artifacts)).filter(name => name.endsWith(".xpi"));
    if (installers.length !== 1) {
      throw new Error("Mozilla has not returned one signed XPI. Check the submission in Developer Hub; no installer was copied.");
    }
    const installer = resolve(artifacts, installers[0]);
    const {stdout} = run("unzip", ["-p", installer, "manifest.json"], {stdio: "pipe", encoding: "utf8"});
    const signedManifest = JSON.parse(stdout);
    if (signedManifest.version !== manifest.version ||
        signedManifest.browser_specific_settings?.gecko?.id !== manifest.browser_specific_settings.gecko.id) {
      throw new Error("Mozilla's returned package has an unexpected add-on ID or version.");
    }
    // Copy the returned archive unchanged: repacking would invalidate Mozilla's signature.
    await copyFile(installer, target);
    console.log(`Signed installer: ${target}`);
  } finally {
    await rm(staging, {recursive: true, force: true});
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
