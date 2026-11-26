import { createApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const app = await createApp(config, {
  log: true,
  serveFrontend: process.env.NODE_ENV === 'production',
});

const shutdown = () => {
  app.close().catch((err: unknown) => {
    app.log.error({ err }, 'Server gagal berhenti');
    process.exitCode = 1;
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await app.listen({ host: config.HOST, port: config.API_PORT });
} catch (err) {
  app.log.error({ err }, 'Server gagal berjalan');
  await app.close();
  process.exitCode = 1;
}
