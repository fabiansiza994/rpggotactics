export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const error = (
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) => json({ error: { code, message, ...extra } }, status);
