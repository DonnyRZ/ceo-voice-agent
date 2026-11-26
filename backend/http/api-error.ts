import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly fields?: Record<string, string>,
    readonly current?: object,
  ) {
    super(message);
  }
}

export function installErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        message: error.message,
        fields: error.fields,
        current: error.current,
      });
    }

    const statusCode = error instanceof Error && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ message: 'Permintaan tidak dapat diproses.' });
    }

    request.log.error({ err: error }, 'Permintaan gagal');
    return reply.code(500).send({ message: 'Terjadi kendala. Silakan coba lagi.' });
  });
}

export function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join('.');
    if (field && !(field in fields)) fields[field] = issue.message;
  }

  throw new ApiError(400, 'Periksa kembali isian Anda.', fields);
}

export function resourceId(input: unknown) {
  const result = z.uuid().safeParse(input);
  if (!result.success) throw new ApiError(404, 'Data tidak ditemukan.');
  return result.data;
}
