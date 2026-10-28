export class BoundaryError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export class DeliveryError extends Error {
  constructor(public readonly code: string, public readonly retryAfterMs?: number, public readonly uncertain = false) { super(code); }
}
