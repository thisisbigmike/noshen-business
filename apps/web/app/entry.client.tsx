import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { isLang, loadCatalog } from "@noshen/shared/i18n";

// The page was drawn on the server in the reader's language. Load that language's words first (only someone who
// chose Pidgin downloads them), so the page picks up exactly where the server left it.
const lang = document.documentElement.dataset.lang;
loadCatalog(isLang(lang) ? lang : "en").catch(() => {}).finally(() => {
  startTransition(() => {
    hydrateRoot(document, <StrictMode><HydratedRouter /></StrictMode>);
  });
});
