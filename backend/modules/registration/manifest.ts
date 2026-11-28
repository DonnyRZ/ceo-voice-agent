import type { FastifyInstance } from 'fastify';

export function registerManifest(app: FastifyInstance, origin: string) {
  app.get('/manifest.webmanifest', async (_, reply) => {
    reply.header('content-type', 'application/manifest+json').header('cache-control', 'no-store');
    return {
      id: '/', name: 'Ruang Kerja', short_name: 'Ruang Kerja', lang: 'id',
      start_url: '/launch?source=installed', scope: '/', display: 'standalone',
      background_color: '#ebf4f5', theme_color: '#00675c',
      icons: [192, 512].map((size) => ({
        src: '/pwa/icon-' + size + '.png', sizes: size + 'x' + size, type: 'image/png', purpose: 'any',
      })),
      related_applications: [{ platform: 'webapp', url: origin + '/manifest.webmanifest', id: origin + '/' }],
      prefer_related_applications: false,
      launch_handler: { client_mode: 'navigate-new' },
    };
  });
}
