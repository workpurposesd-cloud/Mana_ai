import serverless from 'serverless-http'
import { app } from '../../server/server.js'

const serverlessHandler = serverless(app)

export const handler = async (event: any, context: any) => {
  // Normalize incoming event path so Express routes match seamlessly
  if (event.path) {
    if (event.path.startsWith('/.netlify/functions/api')) {
      event.path = event.path.replace('/.netlify/functions/api', '/api')
    } else if (!event.path.startsWith('/api')) {
      event.path = '/api' + (event.path.startsWith('/') ? event.path : '/' + event.path)
    }
  }
  return await serverlessHandler(event, context)
}
