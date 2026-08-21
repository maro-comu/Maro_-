(function (global) {
  "use strict";

  const hostname = global.location?.hostname || "";
  const localPreview = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  global.STUDY_PDF_BASE = localPreview
    ? new URL("../", global.document?.baseURI || global.location.href).href
    : "https://raw.githubusercontent.com/maro-comu/Maro_-/pdf-assets/";
  global.STUDY_SITE_URL = "https://maro-comu.github.io/Maro_-/";
})(typeof window !== "undefined" ? window : globalThis);
