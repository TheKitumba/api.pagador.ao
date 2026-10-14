import Decimal from 'decimal.js';

import { ValidationError } from '@/shared/domain/errors';

/**
 * Safe formula language for calculated pay items (docs/04, 4.5): numbers, + − × ÷, parentheses,
 * dotted variables (contrato.salario_base), and a closed list of functions. No eval, no new Function.
 */

type Node =
  | { kind: 'number'; value: Decimal }
  | { kind: 'string'; value: string }
  | { kind: 'variable'; name: string }
  | { kind: 'unary'; op: '-'; operand: Node }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };

type Token = { type: 'number' | 'identifier' | 'string' | 'op' | 'paren' | 'comma'; value: string };

export const FORMULA_FUNCTIONS = ['min', 'max', 'floor', 'ceil', 'round', 'abs', 'rubrica', 'tabela'] as const;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index++;
    } else if (char === '#') {
      while (index < source.length && source[index] !== '\n') index++;
    } else if (/[0-9.]/.test(char)) {
      let value = '';
      while (index < source.length && /[0-9.]/.test(source[index])) value += source[index++];
      tokens.push({ type: 'number', value });
    } else if (/[A-Za-z_]/.test(char)) {
      let value = '';
      while (index < source.length && /[A-Za-z0-9_.]/.test(source[index])) value += source[index++];
      tokens.push({ type: 'identifier', value });
    } else if (char === '"' || char === "'") {
      const quote = char;
      let value = '';
      index++;
      while (index < source.length && source[index] !== quote) value += source[index++];
      if (source[index] !== quote) throw new ValidationError('Fórmula inválida: texto sem aspas de fecho', { formula: ['Aspas por fechar'] });
      index++;
      tokens.push({ type: 'string', value });
    } else if ('+-*/'.includes(char)) {
      tokens.push({ type: 'op', value: char });
      index++;
    } else if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char });
      index++;
    } else if (char === ',') {
      tokens.push({ type: 'comma', value: char });
      index++;
    } else {
      throw new ValidationError(`Fórmula inválida: carácter "${char}"`, { formula: [`Carácter não permitido: ${char}`] });
    }
  }
  return tokens;
}

/** Recursive-descent parser: expression := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)* */
export function parseFormula(source: string): Node {
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const fail = (message: string): never => {
    throw new ValidationError(`Fórmula inválida: ${message}`, { formula: [message] });
  };
  const expect = (type: Token['type'], value?: string) => {
    const token = tokens[position];
    if (!token || token.type !== type || (value && token.value !== value)) fail(`esperado "${value ?? type}"`);
    position++;
    return token;
  };

  const factor = (): Node => {
    const token = peek();
    if (!token) return fail('expressão incompleta');
    if (token.type === 'op' && token.value === '-') {
      position++;
      return { kind: 'unary', op: '-', operand: factor() };
    }
    if (token.type === 'number') {
      position++;
      if (!/^\d+(\.\d+)?$/.test(token.value)) fail(`número inválido "${token.value}"`);
      return { kind: 'number', value: new Decimal(token.value) };
    }
    if (token.type === 'string') {
      position++;
      return { kind: 'string', value: token.value };
    }
    if (token.type === 'paren' && token.value === '(') {
      position++;
      const inner = expression();
      expect('paren', ')');
      return inner;
    }
    if (token.type === 'identifier') {
      position++;
      if (peek()?.type === 'paren' && peek()?.value === '(') {
        if (!(FORMULA_FUNCTIONS as readonly string[]).includes(token.value)) fail(`função desconhecida "${token.value}"`);
        position++;
        const args: Node[] = [];
        if (!(peek()?.type === 'paren' && peek()?.value === ')')) {
          args.push(expression());
          while (peek()?.type === 'comma') {
            position++;
            args.push(expression());
          }
        }
        expect('paren', ')');
        return { kind: 'call', name: token.value, args };
      }
      return { kind: 'variable', name: token.value };
    }
    return fail(`símbolo inesperado "${token.value}"`);
  };

  const term = (): Node => {
    let node = factor();
    while (peek()?.type === 'op' && (peek()!.value === '*' || peek()!.value === '/')) {
      const op = tokens[position++].value as '*' | '/';
      node = { kind: 'binary', op, left: node, right: factor() };
    }
    return node;
  };

  function expression(): Node {
    let node = term();
    while (peek()?.type === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
      const op = tokens[position++].value as '+' | '-';
      node = { kind: 'binary', op, left: node, right: term() };
    }
    return node;
  }

  if (tokens.length === 0) fail('fórmula vazia');
  const ast = expression();
  if (position < tokens.length) fail(`símbolo a mais "${tokens[position].value}"`);
  return ast;
}

export interface FormulaContext {
  variables: Record<string, Decimal.Value>;
  payItem: (code: string) => Decimal;
  table: (name: string) => Decimal;
}

export function evaluateFormula(ast: Node, context: FormulaContext): Decimal {
  const evaluate = (node: Node): Decimal => {
    switch (node.kind) {
      case 'number':
        return node.value;
      case 'string':
        throw new ValidationError('Texto só pode ser usado como argumento de rubrica() ou tabela()', { formula: ['Uso inválido de texto'] });
      case 'variable': {
        const value = context.variables[node.name];
        if (value === undefined) throw new ValidationError(`Variável desconhecida "${node.name}"`, { formula: [`Variável desconhecida: ${node.name}`] });
        return new Decimal(value);
      }
      case 'unary':
        return evaluate(node.operand).negated();
      case 'binary': {
        const left = evaluate(node.left);
        const right = evaluate(node.right);
        if (node.op === '+') return left.plus(right);
        if (node.op === '-') return left.minus(right);
        if (node.op === '*') return left.times(right);
        if (right.isZero()) return new Decimal(0);
        return left.dividedBy(right);
      }
      case 'call': {
        const textArg = () => {
          const arg = node.args[0];
          if (node.args.length !== 1 || arg.kind !== 'string') throw new ValidationError(`${node.name}() recebe um texto`, { formula: [`${node.name}("…")`] });
          return arg.value;
        };
        if (node.name === 'rubrica') return context.payItem(textArg());
        if (node.name === 'tabela') return context.table(textArg());
        const args = node.args.map(evaluate);
        if (args.length === 0) throw new ValidationError(`${node.name}() precisa de argumentos`, { formula: [node.name] });
        switch (node.name) {
          case 'min':
            return Decimal.min(...args);
          case 'max':
            return Decimal.max(...args);
          case 'floor':
            return args[0].floor();
          case 'ceil':
            return args[0].ceil();
          case 'abs':
            return args[0].abs();
          case 'round':
            return args[0].toDecimalPlaces(args[1]?.toNumber() ?? 2, Decimal.ROUND_HALF_UP);
          default:
            throw new ValidationError(`Função desconhecida ${node.name}`, { formula: [node.name] });
        }
      }
    }
  };
  return evaluate(ast);
}

/** Variables available to formulas (docs/04, 4.5). */
export const FORMULA_VARIABLES = [
  'contrato.salario_base',
  'contrato.horas_semanais',
  'trabalhador.antiguidade_anos',
  'trabalhador.n_dependentes',
  'periodo.dias_uteis',
  'periodo.dias_trabalhados',
  'assiduidade.horas_extra_util',
  'assiduidade.horas_extra_descanso',
  'assiduidade.horas_extra_feriado',
  'assiduidade.horas_nocturnas',
  'assiduidade.faltas_injustificadas',
  'assiduidade.dias_trabalhados',
  'quantidade',
] as const;

/** Validates a formula at save time against sample values (docs/04: "validada na gravação"). */
export function validateFormula(source: string) {
  const ast = parseFormula(source);
  const sample = Object.fromEntries(FORMULA_VARIABLES.map((name) => [name, 1]));
  evaluateFormula(ast, { variables: sample, payItem: () => new Decimal(1), table: () => new Decimal(1) });
  return ast;
}
