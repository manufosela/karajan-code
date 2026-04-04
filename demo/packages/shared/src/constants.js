/** WebSocket event types */
export const WS_EVENTS = {
  CARD_CREATE: 'card:create',
  CARD_UPDATE: 'card:update',
  CARD_DELETE: 'card:delete',
  CARD_MOVE: 'card:move',
  COLUMN_CREATE: 'column:create',
  COLUMN_UPDATE: 'column:update',
  COLUMN_DELETE: 'column:delete',
  COLUMN_REORDER: 'column:reorder',
  BOARD_UPDATE: 'board:update',
  ERROR: 'error',
  JOIN_BOARD: 'join:board',
  LEAVE_BOARD: 'leave:board',
};

/** Structured error codes */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

/** HTTP status mapping */
export const STATUS_CODES = {
  [ERROR_CODES.VALIDATION_ERROR]: 400,
  [ERROR_CODES.UNAUTHORIZED]: 401,
  [ERROR_CODES.FORBIDDEN]: 403,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.INTERNAL_ERROR]: 500,
};
