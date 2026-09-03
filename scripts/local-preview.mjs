import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const productionOrigin = new URL(
  process.env.LOCAL_API_ORIGIN || 'https://findedeinding.vercel.app',
);
const port = Number(process.env.PORT || 3000);

const dynamicPaths = new Set(['/admin', '/portal']);
const staticAliases = new Map([
  ['/', '/index.html'],
  ['/login', '/login.html'],
  ['/zugang', '/login.html'],
  ['/kunden-login', '/login.html'],
]);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const ignoredProxyHeaders = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'transfer-encoding',
]);

function isDynamicRequest(pathname) {
  return pathname.startsWith('/api/') || dynamicPaths.has(pathname);
}

async function proxyRequest(request, response) {
  const target = new URL(request.url, productionOrigin);
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (!ignoredProxyHeaders.has(name) && value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
  }

  headers.set('x-forwarded-host', request.headers.host || `localhost:${port}`);
  headers.set('x-forwarded-proto', 'http');

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
    });

    const responseHeaders = {};
    for (const [name, value] of upstream.headers) {
      if (!ignoredProxyHeaders.has(name) && name !== 'set-cookie') {
        responseHeaders[name] = value;
      }
    }

    const cookies = (upstream.headers.getSetCookie?.() || []).map((cookie) =>
      cookie.replace(/;\s*Secure/gi, ''),
    );
    if (cookies.length) responseHeaders['set-cookie'] = cookies;

    response.writeHead(upstream.status, responseHeaders);
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      error: 'Production-API ist nicht erreichbar.',
      detail: error.message,
    }));
  }
}

function serveStatic(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const mappedPath = staticAliases.get(pathname) || pathname;
  const relativePath = normalize(mappedPath).replace(/^[/\\]+/, '');
  const filePath = resolve(join(projectRoot, relativePath));

  if (!filePath.startsWith(`${projectRoot}/`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    if (!statSync(filePath).isFile()) throw new Error('Not a file');
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url, `http://localhost:${port}`);
  if (isDynamicRequest(pathname)) await proxyRequest(request, response);
  else serveStatic(request, response, pathname);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Lokale Vorschau: http://localhost:${port}`);
  console.log(`API und Daten: ${productionOrigin.origin}`);
  console.log('Hinweis: Datenänderungen wirken auf die verbundene Production-Datenbank.');
});
