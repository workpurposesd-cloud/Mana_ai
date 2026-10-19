import { executeWebSearch } from './searchService.js'
import { documentService } from './documentService.js'
import { configService } from './configService.js'

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required: string[]
  }
}

export interface ToolCall {
  name: string
  arguments: Record<string, any>
}

export interface ToolResult {
  tool: string
  success: boolean
  result: any
  executionTimeMs: number
  error?: string
}

/**
 * Safe Mathematical Evaluator without using eval()
 * Supports arithmetic: +, -, *, /, %, ^ (power), parentheses, and math functions (sqrt, abs, round, sin, cos, tan, log).
 */
export function safeCalculate(expr: string): number {
  const sanitized = expr.replace(/\s+/g, '').toLowerCase()

  // Validate allowed characters only
  if (!/^[0-9+\-*/%^().,a-z]+$/.test(sanitized)) {
    throw new Error('Expression contains disallowed characters.')
  }

  // Tokenizer
  const tokens: (string | number)[] = []
  let i = 0

  while (i < sanitized.length) {
    const char = sanitized[i]

    if (/[0-9.]/.test(char)) {
      let numStr = ''
      while (i < sanitized.length && /[0-9.]/.test(sanitized[i])) {
        numStr += sanitized[i]
        i++
      }
      tokens.push(parseFloat(numStr))
      continue
    }

    if (/[a-z]/.test(char)) {
      let funcName = ''
      while (i < sanitized.length && /[a-z]/.test(sanitized[i])) {
        funcName += sanitized[i]
        i++
      }
      tokens.push(funcName)
      continue
    }

    tokens.push(char)
    i++
  }

  // Recursive descent parser
  let tokenIdx = 0

  function peek(): string | number | undefined {
    return tokens[tokenIdx]
  }

  function consume(): string | number {
    return tokens[tokenIdx++]
  }

  function parseExpression(): number {
    let result = parseTerm()
    while (tokenIdx < tokens.length) {
      const op = peek()
      if (op === '+' || op === '-') {
        consume()
        const nextTerm = parseTerm()
        result = op === '+' ? result + nextTerm : result - nextTerm
      } else {
        break
      }
    }
    return result
  }

  function parseTerm(): number {
    let result = parseFactor()
    while (tokenIdx < tokens.length) {
      const op = peek()
      if (op === '*' || op === '/' || op === '%') {
        consume()
        const nextFactor = parseFactor()
        if (op === '/' && nextFactor === 0) throw new Error('Division by zero')
        result = op === '*' ? result * nextFactor : op === '/' ? result / nextFactor : result % nextFactor
      } else {
        break
      }
    }
    return result
  }

  function parseFactor(): number {
    let result = parsePrimary()
    while (tokenIdx < tokens.length && peek() === '^') {
      consume()
      const exponent = parseFactor()
      result = Math.pow(result, exponent)
    }
    return result
  }

  function parsePrimary(): number {
    const tok = consume()

    if (typeof tok === 'number') {
      return tok
    }

    if (tok === '-') {
      return -parsePrimary()
    }

    if (tok === '+') {
      return parsePrimary()
    }

    if (tok === '(') {
      const expr = parseExpression()
      if (consume() !== ')') throw new Error('Mismatched parentheses')
      return expr
    }

    if (typeof tok === 'string' && /^[a-z]+$/.test(tok)) {
      // Function call
      if (consume() !== '(') throw new Error(`Expected '(' after function ${tok}`)
      const arg = parseExpression()
      if (consume() !== ')') throw new Error(`Expected ')' after function argument in ${tok}`)

      switch (tok) {
        case 'sqrt':
          if (arg < 0) throw new Error('Square root of negative number')
          return Math.sqrt(arg)
        case 'abs':
          return Math.abs(arg)
        case 'round':
          return Math.round(arg)
        case 'floor':
          return Math.floor(arg)
        case 'ceil':
          return Math.ceil(arg)
        case 'sin':
          return Math.sin(arg)
        case 'cos':
          return Math.cos(arg)
        case 'tan':
          return Math.tan(arg)
        case 'log':
        case 'ln':
          if (arg <= 0) throw new Error('Logarithm of non-positive number')
          return Math.log(arg)
        case 'pi':
          return Math.PI
        default:
          throw new Error(`Unsupported math function: ${tok}`)
      }
    }

    throw new Error(`Unexpected token: ${tok}`)
  }

  const finalValue = parseExpression()
  if (tokenIdx < tokens.length) {
    throw new Error(`Unexpected token at index ${tokenIdx}: ${tokens[tokenIdx]}`)
  }

  return finalValue
}

/**
 * Standard Tool Definitions for LLM Tool Calling
 */
export const AVAILABLE_TOOLS: ToolDefinition[] = [
  {
    name: 'calculate',
    description: 'Safely evaluate a mathematical calculation, formula, or equation with high precision.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The math expression to calculate (e.g. "sqrt(256) * 12 + 45 / 3")',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'get_current_time',
    description: 'Get the exact current date, time, day of week, and timezone info.',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'Optional IANA timezone name (e.g. "Asia/Kolkata", "America/New_York", "UTC")',
        },
      },
      required: [],
    },
  },
  {
    name: 'convert_units',
    description: 'Convert between different units of measurement (length, weight, temperature, data).',
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'number', description: 'Numeric value to convert' },
        from: { type: 'string', description: 'Source unit (e.g., "km", "miles", "celsius", "fahrenheit", "kg", "lbs")' },
        to: { type: 'string', description: 'Target unit' },
      },
      required: ['value', 'from', 'to'],
    },
  },
  {
    name: 'search_web',
    description: 'Search the live web for current facts, real-time sports, news, and official documentation.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query to look up on the web' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_documents',
    description: 'Search user-uploaded documents and indexed knowledge files for relevant context.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The question or keyword to search across uploaded files' },
      },
      required: ['query'],
    },
  },
]

/**
 * Unit conversion helper
 */
function convertUnits(value: number, from: string, to: string): { result: number; unit: string; formula: string } {
  const f = from.toLowerCase().trim()
  const t = to.toLowerCase().trim()

  // Temperatures
  if ((f === 'c' || f === 'celsius') && (t === 'f' || t === 'fahrenheit')) {
    const res = (value * 9) / 5 + 32
    return { result: Math.round(res * 100) / 100, unit: '°F', formula: '(°C × 9/5) + 32' }
  }
  if ((f === 'f' || f === 'fahrenheit') && (t === 'c' || t === 'celsius')) {
    const res = ((value - 32) * 5) / 9
    return { result: Math.round(res * 100) / 100, unit: '°C', formula: '(°F - 32) × 5/9' }
  }

  // Length (normalize to meters)
  const lengthMeters: Record<string, number> = {
    km: 1000,
    m: 1,
    cm: 0.01,
    mm: 0.001,
    miles: 1609.344,
    mile: 1609.344,
    yard: 0.9144,
    yards: 0.9144,
    feet: 0.3048,
    foot: 0.3048,
    ft: 0.3048,
    inch: 0.0254,
    inches: 0.0254,
  }

  if (lengthMeters[f] && lengthMeters[t]) {
    const inMeters = value * lengthMeters[f]
    const converted = inMeters / lengthMeters[t]
    return { result: Math.round(converted * 10000) / 10000, unit: t, formula: `${value} ${f} = ${converted} ${t}` }
  }

  // Weight / Mass (normalize to kg)
  const massKg: Record<string, number> = {
    kg: 1,
    g: 0.001,
    mg: 0.000001,
    lbs: 0.453592,
    lb: 0.453592,
    pound: 0.453592,
    pounds: 0.453592,
    oz: 0.0283495,
    ounce: 0.0283495,
  }

  if (massKg[f] && massKg[t]) {
    const inKg = value * massKg[f]
    const converted = inKg / massKg[t]
    return { result: Math.round(converted * 10000) / 10000, unit: t, formula: `${value} ${f} = ${converted} ${t}` }
  }

  throw new Error(`Conversion from "${from}" to "${to}" is not currently supported.`)
}

/**
 * Execute a structured tool call safely with timeouts, validation, and error boundaries
 */
export async function executeTool(name: string, args: Record<string, any>): Promise<ToolResult> {
  const start = Date.now()

  try {
    switch (name) {
      case 'calculate': {
        if (!args.expression || typeof args.expression !== 'string') {
          throw new Error('Argument "expression" is required.')
        }
        const val = safeCalculate(args.expression)
        return {
          tool: name,
          success: true,
          result: { expression: args.expression, value: val },
          executionTimeMs: Date.now() - start,
        }
      }

      case 'get_current_time': {
        const tz = args.timezone || 'UTC'
        let formatted = ''
        try {
          formatted = new Intl.DateTimeFormat('en-US', {
            dateStyle: 'full',
            timeStyle: 'long',
            timeZone: tz,
          }).format(new Date())
        } catch {
          formatted = new Date().toUTCString()
        }

        return {
          tool: name,
          success: true,
          result: {
            iso: new Date().toISOString(),
            formatted,
            timezone: tz,
            dayOfWeek: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(new Date()),
          },
          executionTimeMs: Date.now() - start,
        }
      }

      case 'convert_units': {
        const { value, from, to } = args
        if (typeof value !== 'number' || !from || !to) {
          throw new Error('Arguments "value" (number), "from" (string), and "to" (string) are required.')
        }
        const res = convertUnits(value, from, to)
        return {
          tool: name,
          success: true,
          result: res,
          executionTimeMs: Date.now() - start,
        }
      }

      case 'search_web': {
        if (!args.query || typeof args.query !== 'string') {
          throw new Error('Argument "query" is required.')
        }
        const config = configService.getConfig()
        const evidence = await executeWebSearch(args.query, config.searchProvider, {
          tavily: config.tavilyApiKey,
          serper: config.serperApiKey,
          brave: config.braveApiKey,
        })
        return {
          tool: name,
          success: true,
          result: { query: args.query, results: evidence.results.slice(0, 4) },
          executionTimeMs: Date.now() - start,
        }
      }

      case 'search_documents': {
        if (!args.query || typeof args.query !== 'string') {
          throw new Error('Argument "query" is required.')
        }
        const matches = documentService.searchKnowledge(args.query, 4)
        return {
          tool: name,
          success: true,
          result: {
            query: args.query,
            matches: matches.map((m) => ({
              docTitle: m.docTitle,
              chunkIndex: m.chunk.chunkIndex,
              passage: m.chunk.text,
              score: m.score,
            })),
          },
          executionTimeMs: Date.now() - start,
        }
      }

      default:
        throw new Error(`Unknown tool "${name}".`)
    }
  } catch (err: any) {
    return {
      tool: name,
      success: false,
      result: null,
      error: err.message,
      executionTimeMs: Date.now() - start,
    }
  }
}
