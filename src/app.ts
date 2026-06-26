import express from "express";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import { requestInfo, responseInfo } from "./utils/logger";
import { requestIdMiddleware } from "./middleware/request-id.middleware";
import { dashboardAuth } from "./middleware/dashboard-auth.middleware";
import { errorMiddleware } from "./middleware/error.middleware";
import searchRouter from "./search/search.routes";

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(requestIdMiddleware);
app.use(requestInfo);
app.use(responseInfo);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "audit-service" });
});

app.use("/logs", dashboardAuth, searchRouter);
app.use(errorMiddleware);

export default app;
