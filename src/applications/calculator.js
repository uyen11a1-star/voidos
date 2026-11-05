import { h } from '../desktop/dom.js';
import { evaluate, formatResult, CalcError } from './calc-engine.js';

const KEYS = [['C', '⌫', '(', ')'], ['7', '8', '9', '÷'], ['4', '5', '6', '×'], ['1', '2', '3', '−'], ['0', '.', '%', '+']];

export function openCalculator(desktop) {
  let expr = '', result = '', error = '', justEvaluated = false;
  const exprEl = h('div', { class: 'ca-expr' }), resEl = h('div', { class: 'ca-res' });
  const show = () => {
    exprEl.textContent = expr || '\u00a0';
    resEl.textContent = error || result || (expr ? '' : '0');
    resEl.classList.toggle('err', !!error);
  };
  function live() { // preview the answer while typing; incomplete input just shows nothing
    error = '';
    try { result = expr ? formatResult(evaluate(expr)) : ''; } catch { result = ''; }
  }
  function press(k) {
    if (k === 'C') { expr = ''; result = ''; error = ''; justEvaluated = false; } else if (k === '⌫') { expr = expr.slice(0, -1); live(); } else if (k === '=') {
      if (!expr) return;
      try { result = formatResult(evaluate(expr)); error = ''; expr = result; justEvaluated = true; } catch (e) { if (!(e instanceof CalcError)) throw e; error = e.message; }
    } else {
      if (justEvaluated && /[0-9.(]/.test(k)) expr = ''; // typing a digit after "=" starts over, an operator continues
      justEvaluated = false;
      if (expr.length < 100) expr += k;
      live();
    }
    show();
  }
  const keyEl = (k) => h('button', { class: `ca-key${'÷×−+%'.includes(k) ? ' op' : ''}${k === 'C' ? ' clr' : ''}`, type: 'button', text: k, onclick: () => press(k) });
  const content = h('div', { class: 'ca', tabindex: '0' }, h('div', { class: 'ca-disp' }, exprEl, resEl),
    h('div', { class: 'ca-pad' }, KEYS.flat().map(keyEl), h('button', { class: 'ca-key eq', type: 'button', text: '=', onclick: () => press('=') })));
  content.addEventListener('keydown', (e) => {
    const map = { '*': '×', '/': '÷', '-': '−', ',': '.' };
    if (/^[0-9.+()%]$/.test(e.key)) press(e.key); else if (map[e.key]) press(map[e.key]); else if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); press('='); } else if (e.key === 'Backspace') press('⌫'); else if (e.key === 'Escape') press('C');
  });
  const win = desktop.wm.open({ appId: 'calculator', title: 'Máy tính', icon: 'calculator', content, width: 200, height: 300 });
  win.api = { press, state: () => ({ expr, result, error }) };
  show();
  return win;
}
