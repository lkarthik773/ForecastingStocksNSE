import { kiteReadPaths } from '../../src/kite/client.js';

export const kiteOpenApi = {
  openapi: '3.0.3',
  info: {
    title: 'Kite Integration API',
    version: '0.1.0',
    description: 'HOLD mode. Read-only account access; trading is disabled.',
  },
  servers: [{ url: '/' }],
  security: [{ serviceBearer: [] }],
  components: {
    securitySchemes: {
      serviceBearer: {
        type: 'http',
        scheme: 'bearer',
        description: 'Your service apiToken, not the Kite access token. Enter the token without the Bearer prefix.',
      },
    },
    schemas: {
      AccountResponse: {
        type: 'object',
        properties: {
          data: {},
          mode: { type: 'string', enum: ['HOLD'] },
          tradingEnabled: { type: 'boolean', enum: [false] },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
    },
  },
  paths: Object.fromEntries(['login', 'status', 'connection', ...Object.keys(kiteReadPaths)].map((resource) => [
    `/api/kite/${resource}`,
    {
      get: {
        operationId: `kite_${resource}`,
        tags: [['login', 'status', 'connection'].includes(resource) ? 'Connection' : 'Account'],
        summary: resource === 'login' ? 'Start Kite login' : resource === 'connection' ? 'Verify Kite connection (read profile)' : `Read ${resource}`,
        ...(resource === 'login' ? {
          description: 'Execute in Swagger, then open the returned loginUrl in the same browser within five minutes. Configure the returned redirectUrl in the Kite developer console. Successful login returns to Swagger; tokens stay on the backend. One active login per user/browser.',
        } : {}),
        responses: {
          '200': {
            description: resource === 'login' ? 'Login URL and expiry; browser-binding cookie is set.' : resource === 'status' ? 'Service status; does not contact Kite.' : 'Read-only Kite account result.',
            content: {
              'application/json': {
                schema: resource === 'login' ? {
                  type: 'object',
                  properties: {
                    loginUrl: { type: 'string', format: 'uri' },
                    redirectUrl: { type: 'string', format: 'uri' },
                    expiresInSeconds: { type: 'integer' },
                  },
                } : resource === 'status'
                  ? {
                    type: 'object',
                    properties: {
                      username: { type: 'string' },
                      mode: { type: 'string', enum: ['HOLD'] },
                      tradingEnabled: { type: 'boolean', enum: [false] },
                      accessTokenConfigured: { type: 'boolean' },
                      loginEnabled: { type: 'boolean' },
                      forecastIntegration: { type: 'string' },
                    },
                  }
                  : { $ref: '#/components/schemas/AccountResponse' },
              },
            },
          },
          ...Object.fromEntries([
            ['400', 'Invalid request or login/redirect host mismatch.'],
            ['401', 'Invalid service bearer token.'],
            ['403', 'Host or origin is not allowed.'],
            ['409', 'Login requires backend kiteApiSecret and expected kiteUserId configuration.'],
            ['424', 'Kite authentication or permissions failed; renew the account connection.'],
            ['429', 'Account or broker rate limit reached; wait before retrying.'],
            ['502', 'Kite account read failed.'],
          ].map(([code, description]) => [code, {
            description,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          }])),
        },
      },
    },
  ])),
};

export const swaggerHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kite Integration API</title>
  <link rel="stylesheet" href="/docs/swagger-ui.css">
  <script src="/docs/swagger-ui-bundle.js" defer></script>
  <script src="/docs/init.js" defer></script>
</head>
<body><div id="swagger-ui"></div></body>
</html>`;

export const swaggerInit = `window.ui = SwaggerUIBundle({
  url: '/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  persistAuthorization: false,
  validatorUrl: null,
  supportedSubmitMethods: ['get'],
  defaultModelsExpandDepth: -1,
  displayRequestDuration: true
});`;