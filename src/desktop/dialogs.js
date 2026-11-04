import { h } from './dom.js';

function modal(overlay, cancelValue, build) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
    const done = (v) => { back.remove(); resolve(v); };
    back.append(box);
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(cancelValue); } });
    build(box, done);
    overlay.append(back);
  });
}

// Resolves the typed string, or null when cancelled.
export function showPrompt(overlay, { title, label = '', value = '', okText = 'OK', placeholder = '' }) {
  return modal(overlay, null, (box, done) => {
    const input = h('input', {
      class: 'modal-input', type: 'text', value, placeholder, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false',
      onkeydown: (e) => { if (e.key === 'Enter') done(input.value); },
    });
    box.append(
      h('div', { class: 'modal-title', text: title }),
      label ? h('div', { class: 'modal-label', text: label }) : null,
      input,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', type: 'button', text: 'Hủy', onclick: () => done(null) }),
        h('button', { class: 'btn primary', type: 'button', text: okText, onclick: () => done(input.value) })),
    );
    queueMicrotask(() => { input.focus(); input.select?.(); });
  });
}

// Resolves true/false. cancel:false makes it an info box with a single button.
export function showConfirm(overlay, { message, title = '', okText = 'OK', danger = false, cancel = true }) {
  return modal(overlay, false, (box, done) => {
    box.append(
      title ? h('div', { class: 'modal-title', text: title }) : null,
      h('div', { class: 'modal-msg', text: message }),
      h('div', { class: 'modal-actions' },
        cancel ? h('button', { class: 'btn', type: 'button', text: 'Hủy', onclick: () => done(false) }) : null,
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', text: okText, onclick: () => done(true) })),
    );
  });
}
