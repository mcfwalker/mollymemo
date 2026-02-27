import pino from 'pino'

function createLogger() {
  if (process.env.NODE_ENV === 'development') {
    return pino({
      level: process.env.LOG_LEVEL || 'debug',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
        },
      },
    })
  }

  return pino({
    level: process.env.LOG_LEVEL || 'info',
  })
}

const logger = createLogger()

export default logger
