import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {setTimeout as delay} from "node:timers/promises";
import {JSDOM} from "jsdom";

const script = await readFile(new URL("../extension/video-download.js", import.meta.url), "utf8");
const fixture = await readFile(new URL("fixtures/video-view.html", import.meta.url), "utf8");
const url = "https://isis.tu-berlin.de/mod/videoservice/view.php/cm/1/video/2/view";
const selector = '[data-tu-buddy-video-download]';
function setup(html = fixture, pageUrl = url, responder = async () => ({ok: true, downloadId: 1})) {
  const dom = new JSDOM(html, {url: pageUrl, runScripts: "outside-only"});
  const messages = [];
  dom.window.browser = {runtime: {sendMessage: async message => {
    messages.push(message); return responder(message);
  }}};
  dom.window.eval(script);
  return {dom, doc: dom.window.document, messages, link: () => dom.window.document.querySelector(selector)};
}
async function until(check) {
  for (let i = 0; i < 30; i++) { if (check()) return; await delay(20); }
  assert.ok(check(), "Timed out waiting for video download control");
}
test("the supplied viewer gets a titled download beside its player settings", () => {
  const p = setup();
  try {
    assert.equal(p.link().tagName, "BUTTON");
    assert.equal(p.link().type, "button");
    assert.equal(p.link().hasAttribute("href"), false);
    assert.equal(p.link().title, "Download 6. Leistung.mp4");
    assert.equal(p.link().textContent, "Download");
    assert.equal(p.link().closest(".video-info") !== null, true);
    assert.equal(p.doc.querySelectorAll(selector).length, 1);
  } finally { p.dom.window.close(); }
});
test("existing native video downloads are kept without adding a duplicate", () => {
  for (const [target, control] of [
    ['class="tools">', '<a href="/video.mp4" download>Video</a>'],
    ['class="tools">', '<button title="Video herunterladen"><i class="fa fa-download"></i></button>'],
    ['class="manage">', '<a role="button" title="Download video">Download</a>']
  ]) {
    const p = setup(fixture.replace(target, target + control));
    try { assert.equal(p.link(), null); }
    finally { p.dom.window.close(); }
  }
});
test("Vue rerenders and source changes update one download button", async () => {
  const p = setup('<div id="app"></div>');
  try {
    p.doc.querySelector("#app").innerHTML = fixture;
    await until(() => p.link());
    p.doc.querySelector("video").src = "/mod/videoservice/file.php/second.webm";
    p.doc.querySelector("h3").textContent = '7. Speicher: "Teil/2"';
    await until(() => p.link().title === "Download 7. Speicher- -Teil-2-.webm");
    p.doc.querySelector(".video-info").replaceChildren(p.doc.createElement("span"));
    await until(() => p.link());
    assert.equal(p.doc.querySelectorAll(selector).length, 1);
  } finally { p.dom.window.close(); }
});
test("a native download appearing later replaces the extension fallback", async () => {
  const p = setup();
  try {
    p.doc.querySelector(".tools").insertAdjacentHTML("beforeend", '<button aria-label="Download video">Save</button>');
    await until(() => !p.link());
    p.doc.querySelector('[aria-label="Download video"]').remove();
    await until(() => p.link());
  } finally { p.dom.window.close(); }
});
test("source elements work and multiple players get distinct download names", () => {
  const p = setup(fixture.replace('src="https://isis.tu-berlin.de/mod/videoservice/file.php/fixture.mp4"', "")
    .replace('</video>', '<source src="/mod/videoservice/file.php/camera.mp4" type="video/mp4"></video><video src="/mod/videoservice/file.php/slides.mp4"></video>'));
  try {
    const links = [...p.doc.querySelectorAll(selector)];
    assert.equal(links.length, 2);
    assert.deepEqual(links.map(link => link.title), ["Download 6. Leistung - 1.mp4", "Download 6. Leistung - 2.mp4"]);
  } finally { p.dom.window.close(); }
});
test("unrelated pages, foreign URLs and non-file streams receive no fallback", () => {
  for (const pageUrl of [url.replace(".de/", ".de.attacker.test/"), url.replace("https:", "http:"),
    url.replace("/mod/videoservice/view.php/cm/1/video/2/view", "/course/view.php?id=1")]) {
    const p = setup(fixture, pageUrl);
    try { assert.equal(p.link(), null); }
    finally { p.dom.window.close(); }
  }
  for (const src of ["https://attacker.test/lecture.mp4", "javascript:alert(1)", "blob:https://isis.tu-berlin.de/test",
    "/mod/videoservice/file.php/live.m3u8", "/mod/videoservice/file.php/stream.mpd", "/admin/unsafe.mp4",
    "https://user:pass@isis.tu-berlin.de/mod/videoservice/file.php/lecture.mp4"]) {
    const p = setup(fixture.replace('https://isis.tu-berlin.de/mod/videoservice/file.php/fixture.mp4', src));
    try { assert.equal(p.link(), null, src); }
    finally { p.dom.window.close(); }
  }
});
test("clicking immediately after a source change requests a download and prevents page navigation", async () => {
  const p = setup();
  try {
    const link = p.link();
    Object.defineProperty(p.doc.querySelector("video"), "currentSrc", {value: "https://isis.tu-berlin.de/mod/videoservice/file.php/fixture.mp4"});
    p.doc.querySelector("video").src = "/mod/videoservice/file.php/new.mp4";
    const click = new p.dom.window.MouseEvent("click", {bubbles: true, cancelable: true});
    link.dispatchEvent(click);
    await until(() => !link.disabled);
    assert.equal(click.defaultPrevented, true);
    assert.match(p.messages[0].url, /new\.mp4$/);
    assert.equal(p.messages[0].type, "download-video");
    assert.equal(p.messages[0].filename, "6. Leistung.mp4");
    assert.equal(p.dom.window.location.href, url);
    p.doc.querySelector("video").src = "https://attacker.test/lecture.mp4";
    const event = new p.dom.window.MouseEvent("click", {bubbles: true, cancelable: true});
    link.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(p.link(), null);
    assert.equal(p.messages.length, 1);
  } finally { p.dom.window.close(); }
});
test("one click stays disabled until Firefox starts the download and shows API errors", async () => {
  let finish;
  const p = setup(fixture, url, () => new Promise(resolve => { finish = resolve; }));
  try {
    p.link().click(); p.link().click();
    assert.equal(p.link().disabled, true);
    assert.equal(p.messages.length, 1);
    finish({ok: false, reason: "Download permission is missing."});
    await until(() => !p.link().disabled);
    assert.match(p.doc.querySelector('[role="status"]').textContent, /permission is missing/);
  } finally { p.dom.window.close(); }
});
