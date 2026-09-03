import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App.jsx";

// NOTE: StrictMode double-invokes effects in dev. The SkyCanvas effect is
// written to be idempotent (it guards against a second engine init), but if
// the engine misbehaves under the double-mount, drop StrictMode here.
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
