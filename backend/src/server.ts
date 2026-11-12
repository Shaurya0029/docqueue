import http from "http";
import { createApp } from "./app";
import { env } from "./lib/env";
import { attachWebSocketServer } from "./ws";
import { startSlotHoldExpiryJob } from "./jobs/releaseExpiredHolds";
import { startReminderJob } from "./lib/notifications";

const app = createApp();
const httpServer = http.createServer(app);

attachWebSocketServer(httpServer);
startSlotHoldExpiryJob();
startReminderJob();

httpServer.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`MEDORA API listening on :${env.port} (${env.nodeEnv})`);
});
