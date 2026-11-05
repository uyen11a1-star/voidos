// Expression evaluator for the calculator: a recursive-descent parser, never eval().
// Grammar: expr = term (+|- term)* ; term = power (*|/ power)* ; power = unary (^ power)? ;
//          unary = (+|-) unary | postfix ; postfix = primary (%)* (x% = x/100) ; primary = number | ( expr )
export class CalcError extends Error {}

const MAX_LEN = 200, MAX_DEPTH = 40;

export function evaluate(src) {
  const s = String(src).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '.').replace(/\s+/g, '');
  if (!s) throw new CalcError('Trống');
  if (s.length > MAX_LEN) throw new CalcError('Biểu thức quá dài');
  let i = 0, depth = 0;
  const peek = () => s[i];
  const fail = (m) => { throw new CalcError(m); };

  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  function term() {
    let v = power();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++], r = power();
      if (op === '/' && r === 0) fail('Chia cho 0');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function power() {
    const base = unary();
    if (peek() === '^') { i++; return base ** power(); }
    return base;
  }
  function unary() {
    if (peek() === '-') { i++; return -unary(); }
    if (peek() === '+') { i++; return unary(); }
    return postfix();
  }
  function postfix() {
    let v = primary();
    while (peek() === '%') { i++; v /= 100; }
    return v;
  }
  function primary() {
    if (peek() === '(') {
      if (++depth > MAX_DEPTH) fail('Quá nhiều dấu ngoặc lồng nhau');
      i++;
      const v = expr();
      if (peek() !== ')') fail('Thiếu dấu )');
      i++; depth--;
      return v;
    }
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) fail(i >= s.length ? 'Biểu thức chưa đầy đủ' : `Ký tự không hợp lệ "${s[i]}"`);
    i += m[0].length;
    return Number(m[0]);
  }

  const result = expr();
  if (i < s.length) fail(`Ký tự không hợp lệ "${s[i]}"`);
  if (!Number.isFinite(result)) fail('Kết quả quá lớn');
  return result;
}

export function formatResult(n) {
  if (!Number.isFinite(n)) return 'Lỗi';
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a >= 1e15 || a < 1e-9) return n.toExponential(6).replace(/\.?0+e/, 'e');
  return String(Number(n.toPrecision(12)));
}
