export {};

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
      _body?: boolean;
    }
  }
}
