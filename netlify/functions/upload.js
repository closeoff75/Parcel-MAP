/**
 * Netlify Dedicated Upload Serverless Function
 * Reachable at /.netlify/functions/upload
 * 
 * Supports both direct image upload (<= 4.5 MB) and chunked uploads (> 4.5 MB).
 */

import serverless from 'serverless-http';
import { app } from '../../server/app.js';
import { db } from '../../server/db/database.js';

const handlerInstance = serverless(app, {
  binary: [
    'image/*',
    'application/octet-stream',
    'multipart/form-data'
  ]
});

export const handler = async (event, context) => {
  // CORS preflight handling
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

  // Normalize route to corresponding Express API upload route
  let targetPath = '/api/upload';
  const p = (event.path || '').toLowerCase();
  const action = (event.queryStringParameters?.action || '').toLowerCase();

  if (p.includes('/init') || action === 'init') {
    targetPath = '/api/upload/init';
  } else if (p.includes('/chunk') || action === 'chunk') {
    targetPath = '/api/upload/chunk';
  } else if (p.includes('/complete') || action === 'complete') {
    targetPath = '/api/upload/complete';
  }

  const modifiedEvent = {
    ...event,
    path: targetPath,
    rawPath: targetPath,
    requestContext: {
      ...(event.requestContext || {}),
      http: {
        ...(event.requestContext?.http || {}),
        path: targetPath
      }
    }
  };

  try {
    await db.syncFromNetlifyBlobs();
    return await handlerInstance(modifiedEvent, context);
  } catch (err) {
    console.error('[Netlify Upload Function Error]:', err);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: err.message || 'Serverless upload execution error'
      })
    };
  }
};

export default handler;
