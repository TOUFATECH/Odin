// Erreur HTTP commune aux fournisseurs, avec la logique « faut-il réessayer ? ».
export class HttpError extends Error {
  readonly status: number;
  readonly retryAfterSec: number | undefined;
  constructor(status: number, body: string, retryAfter?: string | null) {
    super(`HTTP ${status} : ${body.slice(0, 400)}`);
    this.status = status;
    this.retryAfterSec = retryAfter && !Number.isNaN(Number(retryAfter)) ? Number(retryAfter) : undefined;
  }
  /** 408, 409, 429 et 5xx sont temporaires ; 400/401/403/404 ne le sont pas. */
  get retryable(): boolean {
    return this.status === 408 || this.status === 409 || this.status === 429 || this.status >= 500;
  }
}
