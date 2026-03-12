import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import logoUrl from "../../assets/whiteNaiLogo.png";
import App from "./App.jsx";
import LivenessPage from "./pages/LivenessPage.jsx";
import TelegramAuth from "./pages/TelegramAuth.jsx";
import "./styles.css";

const favicon =
  document.querySelector("link[rel='icon']") || document.createElement("link");
favicon.setAttribute("rel", "icon");
favicon.setAttribute("type", "image/png");
favicon.setAttribute("href", logoUrl);
document.head.appendChild(favicon);

const root = createRoot(document.getElementById("root"));

if (window.location.pathname === "/liveness") {
  root.render(
    <StrictMode>
      <LivenessPage />
    </StrictMode>,
  );
} else if (window.location.pathname === "/auth/telegram") {
  root.render(
    <StrictMode>
      <TelegramAuth />
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
