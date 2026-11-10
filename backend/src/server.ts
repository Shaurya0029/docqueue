import http from "http";
import { createApp } from "./app";
import { env } from "./lib/env";
import { attachWebSocketServer } from "./ws";
import { startSlotHoldExpiryJob } from "./jobs/releaseExpiredHolds";

const app = createApp();
const httpServer = http.createServer(app);

attachWebSocketServer(httpServer);
startSlotHoldExpiryJob();

httpServer.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`MEDORA API listening on :${env.port} (${env.nodeEnv})`);
});
