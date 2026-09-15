/**
 * Netlify Serverless Function: API Gateway
 * Routes all /api/* requests to the ParcelMap Express backend engine.
 */

import serverless from 'serverless-http';
import { app } from '../../server/app.js';
import { db } from '../../server/db/database.js';

const serverlessHandler = serverless(app, {
  binary: [
    'image/*',
    'application/octet-stream',
    'multipart/form-data',
    'application/pdf'
  ]
});

export const handler = async (event, context) => {
  // Direct CORS preflight handler at edge
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': event.headers?.origin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Range, Accept',
        'Access-Control-Allow-Credentials': 'true'
      },
      body: ''
    };
  }

  // Normalize path so both direct and redirected requests match Express routes perfectly
  let normalizedPath = event.path || '/';
  if (normalizedPath.startsWith('/.netlify/functions/api')) {
    normalizedPath = normalizedPath.replace('/.netlify/functions/api', '');
  }
  if (!normalizedPath.startsWith('/api') && !normalizedPath.startsWith('/uploads')) {
    normalizedPath = `/api${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`;
  }

  const modifiedEvent = {
    ...event,
    path: normalizedPath,
    rawPath: normalizedPath,
    requestContext: {
      ...(event.requestContext || {}),
      http: {
        ...(event.requestContext?.http || {}),
        path: normalizedPath
      }
    }
  };

  try {
    await db.syncFromNetlifyBlobs();
    return await serverlessHandler(modifiedEvent, context);
  } catch (err) {
    console.error('[Netlify Function API Error]:', err);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: err.message || 'Internal Serverless Execution Error'
      })
    };
  }
};

export default handler;
