import consoleStamp from 'console-stamp'
import chalk from 'chalk'

export function initializeConsole() {
  consoleStamp(console, {
    format: ':date(yyyy-mm-dd HH:MM:ss.l).yellow.bgBlue :level() :msg',
    include: ['log', 'info', 'warn', 'error', 'debug'],
    level: 'debug',
    tokens: {
      level: (opts) => {
        // opts.method is the log level (e.g., 'info', 'warn', etc.)
        const level = opts.method
        let colorFn = (s: string) => s // default: no color
        switch (level) {
          case 'info':
            colorFn = chalk.cyan
            break
          case 'debug':
            colorFn = chalk.gray
            break
          case 'warn':
            colorFn = chalk.yellow
            break
          case 'error':
            colorFn = chalk.red
            break
          default:
            colorFn = chalk.white
        }
        // Default label format: [LEVEL]
        const label = `[${level.toUpperCase()}]`.padEnd(7, ' ')
        return colorFn(label)
      },
    },
  })
}
