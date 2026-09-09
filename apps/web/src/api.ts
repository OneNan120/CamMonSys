type ApiErrorBody = {
  error?: {
    message?: string;
  };
};

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);

  if (typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  if (!response.ok) {
    const body: ApiErrorBody | null = await response
      .json()
      .catch(() => null);

    throw new ApiError(
        body?.error?.message ?? `Request failed (${response.status}).`,
        response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}