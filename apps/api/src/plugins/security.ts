/**
 * @fileoverview Implements the Fastify backend application boundary, runtime configuration or shared server behavior consumed by Edutex API modules.
 *
 * @remarks
 * Direct links: `@fastify/cookie`, `@fastify/helmet`, `@fastify/multipart`, `@fastify/rate-limit`, `fastify`, `../shared/errors.js`, `/health/`, `/api/`, `/auth`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

import { ApplicationError } from '../shared/errors.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Installs browser, transport and abuse controls before any application route. */
export async function registerSecurityPlugins(server: FastifyInstance): Promise<void> {
  await server.register(cookie);
  await server.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    /** Implements `keyGenerator` for implements the fastify backend application boundary, runtime configuration or shared server behavior consumed by edutex api modules. It receives `request`. It uses only the local values shown in its body. */ keyGenerator:
      (request) => request.ip,
    /** Implements `errorResponseBuilder` for implements the fastify backend application boundary, runtime configuration or shared server behavior consumed by edutex api modules. It receives `request`. It uses only the local values shown in its body. */ errorResponseBuilder:
      (request) => ({
        statusCode: 429,
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait and try again.',
        requestId: request.id,
      }),
  });
  await server.register(multipart, {
    attachFieldsToBody: false,
    limits: { files: 1, fileSize: 5 * 1024 * 1024, fields: 10, parts: 12 },
    throwFileSizeLimit: true,
  });
  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        upgradeInsecureRequests: server.configuration.nodeEnvironment === 'production' ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: { policy: 'credentialless' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts:
      server.configuration.nodeEnvironment === 'production'
        ? { includeSubDomains: true, maxAge: 63_072_000, preload: true }
        : false,
    referrerPolicy: { policy: 'no-referrer' },
  });

  server.addHook(
    'onRequest',
    /** Performs the local `server.addHook` operation inside `registerSecurityPlugins` and returns control to the surrounding feature only after this body completes. It receives `request`, `reply`. Direct links: `reply.header`, `request.url.startsWith`, `safeMethods.has`, `request.hostname.toLowerCase().replace`, `request.hostname.toLowerCase`. */ async (
      request,
      reply,
    ) => {
      reply.header(
        'permissions-policy',
        'accelerometer=(), ambient-light-sensor=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
      );
      reply.header('x-permitted-cross-domain-policies', 'none');
      reply.header('x-request-id', request.id);

      if (
        server.configuration.nodeEnvironment === 'production' &&
        !request.url.startsWith('/health/') &&
        typeof request.headers['cf-ray'] !== 'string'
      ) {
        throw new ApplicationError(
          403,
          'EDGE_VERIFICATION_FAILED',
          'The request did not pass through the approved edge.',
        );
      }

      if (
        server.configuration.nodeEnvironment === 'production' &&
        !request.url.startsWith('/health/') &&
        request.hostname.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '') !==
          server.configuration.publicHostname
      ) {
        throw new ApplicationError(
          403,
          'HOST_VERIFICATION_FAILED',
          'The request hostname does not match the configured production hostname.',
        );
      }

      if (!safeMethods.has(request.method)) {
        if (request.headers['sec-fetch-site'] === 'cross-site') {
          throw new ApplicationError(
            403,
            'CROSS_SITE_REQUEST_REJECTED',
            'Cross-site requests are not accepted.',
          );
        }
        const origin = request.headers.origin;
        if (origin) {
          let originUrl: URL;
          try {
            originUrl = new URL(origin);
          } catch {
            throw new ApplicationError(403, 'ORIGIN_REJECTED', 'The request origin is invalid.');
          }
          const expectedHostname = request.hostname.toLowerCase().replace(/:\d+$/, '');
          if (
            originUrl.hostname.toLowerCase() !== expectedHostname ||
            (server.configuration.nodeEnvironment === 'production' &&
              originUrl.protocol !== 'https:')
          ) {
            throw new ApplicationError(
              403,
              'ORIGIN_REJECTED',
              'The request origin is not allowed.',
            );
          }
        }
      }

      if (request.url.startsWith('/api/') || request.url.startsWith('/auth')) {
        reply.header('cache-control', 'no-store');
        reply.header('pragma', 'no-cache');
      }
    },
  );
}
