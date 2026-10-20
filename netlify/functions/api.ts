import serverless from 'serverless-http'
import { connectLambda } from '@netlify/blobs'
import { app } from '../../server/server.js'

const serverlessHandler = serverless(app)

export const handler = async (event: any, context: any) => {
  // 1. Connect Netlify Blobs runtime context for global cross-device cloud persistence
  try {
    connectLambda(event)
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
