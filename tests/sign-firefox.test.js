import {test} from "node:test";
import assert from "node:assert/strict";
import {copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";

const scripts = resolve(import.meta.dirname, "../scripts");
const manifest = {manifest_version: 3, name: "Signing fixture", version: "1.0.0",
  browser_specific_settings: {gecko: {id: "fixture@example.test"}}};

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "tu-sign-test-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const dir of ["scripts", "extension", "node_modules/web-ext/bin", "dist", "temp"]) {
    await mkdir(resolve(root, dir), {recursive: true});
  }
  for (const name of ["build.mjs", "sign-firefox.mjs"]) {
    await copyFile(resolve(scripts, name), resolve(root, "scripts", name));
  }
  await writeFile(resolve(root, "extension/manifest.json"), JSON.stringify(manifest));
  await writeFile(resolve(root, "credentials-not-to-package.txt"), "private fixture data");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("WEB_EXT_")));
  return {root, env: {...env, TMPDIR: resolve(root, "temp"), WEB_EXT_API_KEY: "fake-issuer", WEB_EXT_API_SECRET: "fake-secret"}};
}

function run(p) {
  const result = spawnSync(process.execPath, [resolve(p.root, "scripts/sign-firefox.mjs")],
    {cwd: p.root, env: p.env, encoding: "utf8"});
  if (result.error) throw result.error;
  return result;
}

// An offline stand-in for Mozilla's CLI, never an actual signature or API call.
const signer = `
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
assert.equal(args[0], 'sign');
assert.equal(option('--amo-base-url'), 'https://addons.mozilla.org/api/v5/');
assert.equal(option('--channel'), 'unlisted');
assert.ok(args.includes('--no-config-discovery'));
assert.ok(!args.join(' ').includes('fake-secret'));
assert.ok(!args.join(' ').includes('fake-issuer'));
assert.equal(process.env.WEB_EXT_AMO_BASE_URL, undefined);
assert.equal(process.env.WEB_EXT_API_SECRET, 'fake-secret');
const source = option('--source-dir');
assert.deepEqual(fs.readdirSync(source), ['manifest.json']);
fs.writeFileSync(path.join(source, '.amo-upload-uuid'), 'test upload bookkeeping');
if (process.env.FIXTURE_MODE === 'fail') process.exit(1);
if (process.env.FIXTURE_MODE === 'pending') process.exit(0);
if (process.env.FIXTURE_MODE === 'wrong-id') {
  const file = path.join(source, 'manifest.json');
  const data = JSON.parse(fs.readFileSync(file));
  data.browser_specific_settings.gecko.id = 'wrong@example.test';
  fs.writeFileSync(file, JSON.stringify(data));
}
const archive = path.join(option('--artifacts-dir'), 'returned.xpi');
assert.equal(cp.spawnSync('zip', ['-q', archive, 'manifest.json'], {cwd: source}).status, 0);
fs.copyFileSync(archive, path.resolve('returned-fixture.bin'));
`;

test("signing without API credentials fails before uploading or building, without printing secret values", async t => {
  const p = await fixture(t);
  delete p.env.WEB_EXT_API_KEY;
  const result = run(p);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Set WEB_EXT_API_KEY/);
  assert.ok(!result.stderr.includes(p.env.WEB_EXT_API_SECRET));
  assert.deepEqual(await readdir(resolve(p.root, "dist")), []);
});

test("signing stages only the package and copies returned installer bytes unchanged", async t => {
  const p = await fixture(t);
  p.env.WEB_EXT_AMO_BASE_URL = "https://invalid.example/";
  await writeFile(resolve(p.root, "node_modules/web-ext/bin/web-ext.js"), signer);
  const result = run(p);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(await readFile(resolve(p.root, "dist/tu-buddy-1.0.0.xpi")),
    await readFile(resolve(p.root, "returned-fixture.bin")));
  assert.deepEqual(await readdir(resolve(p.root, "extension")), ["manifest.json"]);
  assert.deepEqual(await readdir(resolve(p.root, "temp")), []);
});

test("failed, pending or mismatched submissions cannot leave an installer that looks newly signed", async t => {
  for (const mode of ["fail", "pending", "wrong-id"]) {
    const p = await fixture(t);
    p.env.FIXTURE_MODE = mode;
    await writeFile(resolve(p.root, "node_modules/web-ext/bin/web-ext.js"), signer);
    await writeFile(resolve(p.root, "dist/tu-buddy-1.0.0.xpi"), "old artifact");
    const result = run(p);
    assert.equal(result.status, 1, `${mode}: ${result.stdout} ${result.stderr}`);
    assert.ok(!(await readdir(resolve(p.root, "dist"))).some(name => name.endsWith(".xpi")));
    assert.deepEqual(await readdir(resolve(p.root, "temp")), []);
  }
});
