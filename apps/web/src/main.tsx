import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { apiMode, enableDemoPersistence } from "@/shared/api";
import "./index.css";

/* Before the first render, so the first query reads the visitor's saved demo
   state rather than the seed. Fixtures mode only: a Supabase build has nothing
   in the browser to remember. */
if (apiMode() === "fixtures") enableDemoPersistence();

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
