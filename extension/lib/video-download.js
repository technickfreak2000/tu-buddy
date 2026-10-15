const ISIS = "https://isis.tu-berlin.de";
const viewerPath = path => /^\/mod\/videoservice\/view\.php(?:\/|$)/.test(path);

export async function downloadVideo(api, message, sender) {
  let page, source, filename;
  try {
    if (sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) ||
        typeof message.url !== "string" || typeof message.filename !== "string" || message.filename.length > 512) return {ok: false};
    page = new URL(sender.url);
    source = new URL(message.url);
    if (page.origin !== ISIS || page.username || page.password || !viewerPath(page.pathname) ||
        source.origin !== ISIS || source.username || source.password || source.hash ||
        !/^\/(?:mod\/videoservice\/file\.php|pluginfile\.php)\//.test(source.pathname) ||
        !/\.(?:mp4|m4v|webm|ogv|mov)$/i.test(source.pathname)) return {ok: false};
    const extension = source.pathname.match(/\.[^.]+$/)[0].toLowerCase();
    filename = message.filename.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
      .replace(/^[. ]+|[. ]+$/g, "").slice(0, 200) || "ISIS video";
    if (!filename.toLowerCase().endsWith(extension)) filename += extension;
  } catch { return {ok: false}; }
  try {
    const tab = await api.tabs.get(sender.tab.id);
    const current = new URL(tab.url);
    if (current.origin !== page.origin || current.pathname !== page.pathname || current.search !== page.search) return {ok: false};
    const options = {url: source.href, filename, conflictAction: "uniquify"};
    // Use the viewer's session, including Firefox containers and private windows.
    if (tab.incognito) options.incognito = true;
    else if (tab.cookieStoreId) options.cookieStoreId = tab.cookieStoreId;
    const downloadId = await api.downloads.download(options);
    return {ok: true, downloadId};
  } catch {
    return {ok: false, reason: "Could not start the download. Check the extension's download permission and try again."};
  }
}
