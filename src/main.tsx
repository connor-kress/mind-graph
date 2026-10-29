import { useAuth } from "@clerk/react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { AccountProvider } from "./components/AccountProvider";
import { AccountGate } from "./components/AccountGate";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AccountProvider>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <AccountGate>
          <App />
        </AccountGate>
      </ConvexProviderWithClerk>
    </AccountProvider>
  </StrictMode>,
);
