(() => {
  const currentScript = document.currentScript;
  if (!currentScript) return;

  const tenantId = currentScript.getAttribute("data-tenant");
  if (!tenantId) {
    console.warn("Chat widget: missing data-tenant attribute.");
    return;
  }

  const title = currentScript.getAttribute("data-title") || "Live support";
  const host = currentScript.getAttribute("data-host") || "";
  const width = currentScript.getAttribute("data-width") || "360";
  const height = currentScript.getAttribute("data-height") || "600";

  const srcBase = host || window.location.origin;

  fetch(`${srcBase}/api/tenant/authorize?tenant=${encodeURIComponent(tenantId)}`)
    .then((response) => response.json())
    .then((data) => {
      if (!data.authorized || !data.token) {
        console.warn("Chat widget: domain not authorized.", data.message || "");
        return;
      }

      const iframe = document.createElement("iframe");
      iframe.src = `${srcBase}/widget?tenant=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(data.token)}`;
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

      document.body.appendChild(iframe);
    })
    .catch((error) => {
      console.warn("Chat widget: authorization request failed.", error);
    });
})();
