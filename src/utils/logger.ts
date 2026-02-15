import type { ChalkInstance } from 'chalk'

import chalk from 'chalk'

type Level = 'debug' | 'log' | 'warn' | 'error'

const levels: Record<Level, ChalkInstance> = {
  debug: chalk.magentaBright,
  log: chalk.white,
  warn: chalk.yellowBright,
  error: chalk.redBright,
}

function stringToColor(str: string): ChalkInstance {
  let hash = 0
  for (const char of str) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0

  const hue = Math.abs(hash) % 360
  const s = 0.5
  const l = 0.75
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + hue / 30) % 12
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
  }

  return chalk.rgb(
    Math.round(f(0) * 255),
    Math.round(f(8) * 255),
    Math.round(f(4) * 255),
  )
}

function format(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value !== 'object') return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[Circular]'
  }
}

export class Logger {
  private readonly color?: ChalkInstance

  constructor(private readonly context?: string) {
    this.color = context ? stringToColor(context) : undefined
  }

  debug(msg: unknown, ...args: unknown[]) {
    this.print('debug', msg, ...args)
  }
  log(msg: unknown, ...args: unknown[]) {
    this.print('log', msg, ...args)
  }
  warn(msg: unknown, ...args: unknown[]) {
    this.print('warn', msg, ...args)
  }
  error(msg: unknown, ...args: unknown[]) {
    this.print('error', msg, ...args)
  }

  private print(level: Level, msg: unknown, ...args: unknown[]): void {
    const color = levels[level]
    const time = chalk.dim(new Date().toLocaleTimeString('en-US'))
    const levelLabel = color(level.toUpperCase().padEnd(5))
    const app = chalk.greenBright('[Cilantro]')
    const ctx =
      this.context && this.color ? this.color(`[${this.context}]`) : ''
    const text = color([msg, ...args].map(format).join(' '))

    console.log([app, time, levelLabel, ctx, text].filter(Boolean).join(' '))
  }
}
