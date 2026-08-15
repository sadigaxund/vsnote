import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider, Toaster } from "my-you-eye";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster />
    </TooltipProvider>
  </StrictMode>,
);
