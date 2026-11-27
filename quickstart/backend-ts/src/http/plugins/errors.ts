import { TenantRegistrationError } from '../../modules/tenants';

/** Preserves the API's JSON error shape and problem content type. */
export function problem(status: number, message: string) {
  return Response.json(
    { message },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

/** Maps recognized errors to a response and lets callers handle unexpected failures. */
export function tenantRegistrationProblem(error: unknown, code: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof TenantRegistrationError) return problem(error.status, error.message);
  if (code === 'VALIDATION' || code === 'PARSE') return problem(400, 'Invalid request');
}
