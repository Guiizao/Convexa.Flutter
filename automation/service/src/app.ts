import express from "express";
import { env } from "./env.js";
import { errorHandler } from "./http/util.js";
import { panelRoutes } from "./http/panel.js";
import { whatsappRoutes } from "./http/whatsapp.js";

export function buildApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // CORS só para o painel
  app.use((req, res, next) => {
    const origin = req.header("origin");
    const allowed = env().CORS_ORIGINS;
    if (origin && (allowed.length === 0 || allowed.includes(origin))) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: "15mb" })); // comprovante vem em base64

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use(whatsappRoutes);
  app.use(panelRoutes);
  app.use(errorHandler);
  return app;
}
