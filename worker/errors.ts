import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** 사용자에게 그대로 보여 줘도 되는 오류. message 는 화면에 뜬다. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what}을(를) 찾을 수 없습니다.`);
export const badRequest = (message: string) => new AppError(400, 'bad_request', message);
export const forbidden = (message: string) => new AppError(403, 'forbidden', message);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
