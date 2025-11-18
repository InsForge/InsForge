import { Router, Request, Response } from 'express';
import { OpenAPIService } from '@/services/documentation/openapi.service.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import logger from '@/utils/logger.js';

const router = Router();
const openAPIService = OpenAPIService.getInstance();

/**
 * GET /api/openapi
 * Get the OpenAPI specification document
 */
router.get('/', async (_req: Request, res: Response, next) => {
  try {
    const openAPIDocument = await openAPIService.generateOpenAPIDocument();
    successResponse(res, openAPIDocument);
  } catch (error) {
    logger.error('Failed to generate OpenAPI document', {
      error: error instanceof Error ? error.message : String(error),
    });
    next(new AppError('Failed to generate OpenAPI document', 500, ERROR_CODES.INTERNAL_ERROR));
  }
});

/**
 * GET /api/openapi/swagger
 * Serve Swagger UI HTML page
 */
router.get('/swagger', (_req: Request, res: Response) => {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>InsForge API Documentation</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
      <style>
        body {
          margin: 0;
          padding: 0;
        }
        .swagger-ui .topbar {
          display: none;
        }
      </style>
    </head>
    <body>
      <div id="swagger-ui"></div>
      <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
      <script>
        window.onload = () => {
          window.ui = SwaggerUIBundle({
            url: '/api/openapi',
            dom_id: '#swagger-ui',
            deepLinking: true,
            presets: [
              SwaggerUIBundle.presets.apis,
              SwaggerUIBundle.SwaggerUIStandalonePreset
            ],
            layout: 'BaseLayout',
            tryItOutEnabled: true,
            requestInterceptor: (request) => {
              // Add API key from localStorage if available
              const apiKey = localStorage.getItem('insforge_api_key');
              if (apiKey) {
                request.headers['x-api-key'] = apiKey;
              }
              return request;
            }
          });
        };
      </script>
    </body>
    </html>
  `;
  res.type('html').send(html);
});

export { router as openAPIRouter };
