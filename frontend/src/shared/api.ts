export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorPayload {
  message?: string;
  fields?: Record<string, string>;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('json')) {
    throw new ApiError(response.status, 'Respons server tidak dapat dibaca.');
  }

  const data = await response.json() as T | ErrorPayload;
  if (!response.ok) {
    const error = data as ErrorPayload | null;
    throw new ApiError(
      response.status,
      error?.message || 'Permintaan tidak berhasil. Coba lagi.',
      error?.fields,
    );
  }
  return data as T;
}
