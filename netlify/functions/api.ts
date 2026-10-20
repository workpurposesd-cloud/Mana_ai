import serverless from 'serverless-http'
import { connectLambda, setEnvironmentContext } from '@netlify/blobs'
import { app } from '../../server/server.js'

const serverlessHandler = serverless(app)

export const handler = async (event: any, context: any) => {
  // 1. Connect Netlify Blobs runtime context for global cross-device cloud persistence
  try {
    connectLambda(event)
    if (event.blobs) {
      try {
        const raw = Buffer.from(event.blobs, 'base64').toString('utf-8')
        const data = JSON.parse(raw)
        setEnvironmentContext({
          deployID: event.headers?.['x-nf-deploy-id'] || event.headers?.['X-NF-DEPLOY-ID'],
          edgeURL: data.url,
          uncachedEdgeURL: data.url,
          siteID: event.headers?.['x-nf-site-id'] || event.headers?.['X-NF-SITE-ID'],
          token: data.token,
        })
      } catch {}
    }
  } catch (err: any) {
    // connectLambda safely ignores if event is not from a Netlify Blobs invocation
  }

  // 2. Normalize incoming event path so Express routes match seamlessly
  if (event.path) {
    if (event.path.startsWith('/.netlify/functions/api')) {
      event.path = event.path.replace('/.netlify/functions/api', '/api')
    } else if (!event.path.startsWith('/api')) {
      event.path = '/api' + (event.path.startsWith('/') ? event.path : '/' + event.path)
    }
  }

  return await serverlessHandler(event, context)
}
