import { RoleSchema } from '@insforge/shared-schemas';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id?: string;
        email?: string;
        role: RoleSchema;
      };
      authenticated?: boolean;
      hasApiKey?: boolean;
      projectId?: string;
    }
  }
}
