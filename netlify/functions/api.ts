import serverless from 'serverless-http'
import { app } from '../../server/server.js'

export const handler = serverless(app)
