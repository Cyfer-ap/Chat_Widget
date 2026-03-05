(() => {
  const currentScript = document.currentScript;
  if (!currentScript) return;

  const tenantId = currentScript.getAttribute("data-tenant");
  if (!tenantId) {
    console.warn("Chat widget: missing data-tenant attribute.");
    return;
  }

  const title = currentScript.getAttribute("data-title") || "Live support";
  const host = currentScript.getAttribute("data-host") || new URL(currentScript.src).origin;
  const width = currentScript.getAttribute("data-width") || "360";
  const height = currentScript.getAttribute("data-height") || "600";
  const refreshMs = Number(currentScript.getAttribute("data-token-refresh-ms")) || 240000;

  const postToken = (iframe, token) => {
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(
      { type: "widget-token", token, tenant: tenantId },
      host
    );
  };

  const fetchToken = () =>
    fetch(`${host}/api/tenant/authorize?tenant=${encodeURIComponent(tenantId)}`)
      .then((response) => response.json());

  fetchToken()
    .then((data) => {
      if (!data.authorized || !data.token) {
        console.warn("Chat widget: domain not authorized.", data.message || "");
        return;
      }

      const iframe = document.createElement("iframe");
      iframe.src = `${host}/widget?tenant=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(data.token)}`;
      iframe.title = title;
      iframe.style.position = "fixed";
      iframe.style.bottom = "0";
      iframe.style.right = "0";
      iframe.style.width = `${width}px`;
      iframe.style.height = `${height}px`;
      iframe.style.border = "0";
      iframe.style.zIndex = "99999";
      iframe.style.background = "transparent";
      iframe.style.pointerEvents = "auto";

      iframe.addEventListener("load", () => postToken(iframe, data.token));
      const refreshHandle = setInterval(() => {
        fetchToken()
          .then((refreshData) => {
            if (!refreshData.authorized || !refreshData.token) return;
            postToken(iframe, refreshData.token);
          })
          .catch((error) => {
            console.warn("Chat widget: token refresh failed.", error);
          });
      }, refreshMs);

      iframe.addEventListener("error", () => clearInterval(refreshHandle));

      document.body.appendChild(iframe);
    })
    .catch((error) => {
      console.warn("Chat widget: authorization request failed.", error);
    });
})();
