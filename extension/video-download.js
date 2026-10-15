(() => {
  const ISIS = "https://isis.tu-berlin.de";
  if (window.top !== window || location.origin !== ISIS) return;
  const marker = "data-tu-buddy-video-download";
  const links = new Map();
  let timer;

  function sourceFor(video) {
    const explicit = video.getAttribute("src");
    // currentSrc can still refer to the previous lecture while a new src loads.
    const candidates = explicit ? [explicit] : [video.currentSrc,
      ...[...video.querySelectorAll("source[src]")].map(source => source.getAttribute("src"))];
    for (const value of candidates.filter(Boolean)) {
      try {
        const url = new URL(value, video.baseURI);
        if (url.origin === ISIS && !url.username && !url.password &&
            /^\/(?:mod\/videoservice\/file\.php|pluginfile\.php)\//.test(url.pathname) &&
            /\.(?:mp4|m4v|webm|ogv|mov)$/i.test(url.pathname)) {
          url.hash = "";
          return url;
        }
      } catch { /* Unsupported sources do not get a download link. */ }
    }
    return null;
  }
  function nativeDownload(root) {
    return Boolean(root && [...root.querySelectorAll('a, button, input[type="button"], input[type="submit"]')].some(control => {
      if (control.hasAttribute(marker) || control.closest(`[${marker}]`)) return false;
      const label = [control.textContent, control.value, control.title, control.getAttribute("aria-label")].filter(Boolean).join(" ");
      return control.matches('a[download], .vjs-download-button, [data-action="download"]') ||
        Boolean(control.querySelector('.fa-download, .fa-file-download')) || /\bdownload\b|herunterladen/i.test(label);
    }));
  }
  function filenameFor(video, source) {
    const viewer = video.closest(".video-view");
    const title = viewer.querySelector("h3")?.textContent.trim() || "ISIS video";
    const name = title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-").replace(/\s+/g, " ")
      .replace(/^[. ]+|[. ]+$/g, "").slice(0, 160) || "ISIS video";
    const videos = [...viewer.querySelectorAll(".video-box video")];
    const suffix = videos.length > 1 ? ` - ${videos.indexOf(video) + 1}` : "";
    return `${name}${suffix}${source.pathname.match(/\.[^.]+$/)[0].toLowerCase()}`;
  }
  function updateLink(link, video, source) {
    const filename = filenameFor(video, source);
    if (link.href !== source.href) link.href = source.href;
    if (link.download !== filename) link.download = filename;
    if (link.title !== `Download ${filename}`) link.title = `Download ${filename}`;
  }
  function refresh() {
    clearTimeout(timer);
    timer = null;
    const available = new Set();
    if (/^\/mod\/videoservice\/view\.php(?:\/|$)/.test(location.pathname)) {
      for (const viewer of document.querySelectorAll(".video-view")) {
        const globalDownload = nativeDownload(viewer.querySelector(":scope > .buttons"));
        for (const box of viewer.querySelectorAll(".video-box")) {
          if (globalDownload || nativeDownload(box)) continue;
          for (const video of box.querySelectorAll("video")) {
            const source = sourceFor(video);
            if (!source) continue;
            available.add(video);
            let link = links.get(video);
            if (!link?.isConnected) {
              link = document.createElement("a");
              link.setAttribute(marker, "");
              link.className = "btn btn-outline-secondary btn-sm tu-buddy-video-download";
              link.style.marginInlineStart = "8px";
              const icon = document.createElement("i");
              icon.className = "icon fa fa-download fa-fw";
              icon.setAttribute("aria-hidden", "true");
              link.append(icon, document.createTextNode("Download"));
              link.addEventListener("click", event => {
                const latest = video.isConnected && sourceFor(video);
                if (!latest || !video.closest(".video-view") || !/^\/mod\/videoservice\/view\.php(?:\/|$)/.test(location.pathname)) {
                  event.preventDefault(); refresh(); return;
                }
                // Re-read on click so Vue navigation cannot leave a stale video URL.
                updateLink(link, video, latest);
              });
              const info = box.querySelector(".video-info");
              const tools = info?.querySelector(":scope > span:last-child") || info || box;
              tools.append(link);
              links.set(video, link);
            }
            updateLink(link, video, source);
          }
        }
      }
    }
    for (const [video, link] of links) {
      if (!available.has(video)) { link.remove(); links.delete(video); }
    }
  }
  function schedule() {
    if (!timer) timer = setTimeout(() => { timer = null; refresh(); }, 100);
  }
  new MutationObserver(schedule).observe(document.documentElement, {subtree: true, childList: true,
    characterData: true, attributes: true, attributeFilter: ["src", "type", "href", "download", "title", "aria-label", "class"]});
  for (const type of ["loadstart", "loadedmetadata", "emptied"]) document.addEventListener(type, schedule, true);
  window.addEventListener("popstate", schedule);
  refresh();
})();
