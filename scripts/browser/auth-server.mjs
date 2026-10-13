import http from 'node:http';
import { authPort, origin } from './settings.mjs';
import { user, session } from './session.mjs';

const server = http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  );
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (
    request.method === 'OPTIONS' ||
    new URL(request.url, origin).pathname === '/auth/v1/logout'
  ) {
    response.writeHead(204).end();
    return;
  }
  if (request.url === '/health') {
    response.end('synthetic-auth-ready');
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/auth/v1/user') {
    // Do not authenticate anonymous requests to the synthetic service.
    if (!request.headers.authorization?.startsWith('Bearer ')) {
      response
        .writeHead(401)
        .end(JSON.stringify({ message: 'Missing bearer' }));
      return;
    }
    response.end(JSON.stringify(user));
  } else if (
    request.url === '/auth/v1/token?grant_type=password' ||
    request.url === '/auth/v1/token?grant_type=refresh_token'
  ) {
    response.end(JSON.stringify(session()));
  } else {
    response
      .writeHead(404)
      .end(JSON.stringify({ message: 'Unknown synthetic Auth route' }));
  }
});
server.listen(authPort, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    server.closeAllConnections();
    server.close();
  });
