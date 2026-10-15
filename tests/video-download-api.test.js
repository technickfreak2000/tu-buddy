import {test} from "node:test";
import assert from "node:assert/strict";
import {downloadVideo} from "../extension/lib/video-download.js";

const page = "https://isis.tu-berlin.de/mod/videoservice/view.php/cm/1/video/2/view";
const source = "https://isis.tu-berlin.de/mod/videoservice/file.php/fixture.mp4";
const sender = {url: page, tab: {id: 7}, frameId: 0};
const message = {type: "download-video", url: source, filename: "6. Leistung.mp4"};
function setup(tab = {id: 7, url: page, cookieStoreId: "firefox-default"}) {
  const downloads = [];
  const api = {tabs: {get: async () => tab}, downloads: {download: async options => { downloads.push(options); return 42; }}};
  return {api, downloads};
}
test("a viewer click starts a Firefox download with its filename and cookie store", async () => {
  const p = setup();
  assert.deepEqual(await downloadVideo(p.api, message, sender), {ok: true, downloadId: 42});
  assert.deepEqual(p.downloads, [{url: source, filename: message.filename, conflictAction: "uniquify", cookieStoreId: "firefox-default"}]);
});
test("downloads use the actual tab's container or private session, never message-supplied cookie context", async () => {
  for (const [tab, context] of [
    [{id: 7, url: page, cookieStoreId: "firefox-container-3"}, {cookieStoreId: "firefox-container-3"}],
    [{id: 7, url: page, incognito: true, cookieStoreId: "firefox-private"}, {incognito: true}]
  ]) {
    const p = setup(tab);
    assert.equal((await downloadVideo(p.api, {...message, cookieStoreId: "attacker"}, sender)).ok, true);
    assert.deepEqual(p.downloads[0], {url: source, filename: message.filename, conflictAction: "uniquify", ...context});
  }
});
test("websites, frames, unrelated ISIS pages and arbitrary URLs cannot invoke downloads", async () => {
  const p = setup();
  for (const wrongSender of [
    {...sender, frameId: 1}, {...sender, tab: undefined},
    {...sender, url: page.replace(".de/", ".de.attacker.test/")},
    {...sender, url: "https://isis.tu-berlin.de/course/view.php?id=1"},
    {...sender, url: "moz-extension://test/options/options.html"}
  ]) assert.equal((await downloadVideo(p.api, message, wrongSender)).ok, false);
  for (const url of ["https://attacker.test/lecture.mp4", "file:///tmp/video.mp4", "javascript:alert(1)",
    source.replace("https:", "http:"), source.replace(".de/", ".de:8443/"), source.replace(".mp4", ".m3u8"),
    "https://isis.tu-berlin.de/admin/video.mp4", source + "#fragment"]) {
    assert.equal((await downloadVideo(p.api, {...message, url}, sender)).ok, false);
  }
  assert.equal(p.downloads.length, 0);
});
test("filenames cannot escape the downloads folder or change the media extension", async () => {
  const p = setup();
  await downloadVideo(p.api, {...message, filename: "../../bad.exe"}, sender);
  const name = p.downloads[0].filename;
  assert.equal(/[\\/]/.test(name), false);
  assert.equal(name.startsWith("."), false);
  assert.equal(name.endsWith(".mp4"), true);
});
test("navigation away and rejected download promises do not start a browser navigation", async () => {
  const p = setup({id: 7, url: "https://example.org/"});
  assert.equal((await downloadVideo(p.api, message, sender)).ok, false);
  assert.equal(p.downloads.length, 0);
  const failed = setup();
  failed.api.downloads.download = async () => { throw new Error("permission denied"); };
  const result = await downloadVideo(failed.api, message, sender);
  assert.equal(result.ok, false);
  assert.match(result.reason, /permission/);
});
