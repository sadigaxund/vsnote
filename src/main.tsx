import { Buffer } from "buffer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider, Toaster } from "my-you-eye";
import "./index.css";
import App from "./App";

declare global {
  var Buffer: typeof import("buffer").Buffer;
}

// isomorphic-git's index (.git/index) reader/writer uses Node's `Buffer`
// global directly (confirmed in node_modules/isomorphic-git/index.js —
// `GitIndex`'s buffer parsing/serialization). The browser has no such
// global; polyfill it once here, before any git/fs module runs, rather
// than pulling in a full node-polyfills bundler plugin for one global.
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster />
    </TooltipProvider>
  </StrictMode>,
);
