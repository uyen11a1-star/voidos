// @vitest-environment jsdom
// End-to-end: the real page script, real boot sequence, real desktop, IndexedDB persistence across "page reloads".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const $ = (id) => document.getElementById(id);
const enter = (input, line) => { input.value = line; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); };
const terminalInput = () => document.querySelector('.vo-root .term-in');
const T = { timeout: 15000, interval: 40 };
HTMLCanvasElement.prototype.getContext = () => null; // jsdom has no canvas
const unlock = () => { const l = document.querySelector('.vo-lock'); if (l && !l.hidden) l.click(); };

async function loadPage() {
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  vi.resetModules();
  await import('../src/main.js');
  // the click handler is attached once the disk is open
  await vi.waitFor(() => { $('power').click(); expect($('boot-log').textContent).toContain('VoidBIOS'); }, T);
  await vi.waitFor(() => expect($('desktop-root').hidden).toBe(false), T);
  unlock();
}
const openTerminal = async () => {
  [...document.querySelectorAll('.vo-icon')].find((b) => b.title === 'Terminal').click();
  await vi.waitFor(() => expect(terminalInput()).toBeTruthy());
};

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
afterEach(async () => {
  // power the machine off so its timers stop
  if (terminalInput()) { enter(terminalInput(), 'shutdown'); await vi.waitFor(() => expect($('desktop-root').hidden).toBe(true), T); }
});

describe('whole system in the page', () => {
  it('boots from a blank disk: BIOS log, installs system, desktop appears', async () => {
    await loadPage();
    const log = $('boot-log').textContent;
    expect(log).toMatch(/VoidBIOS/);
    expect(log).toMatch(/No bootable system on disk0/);
    expect(log).toMatch(/Recovery installer/);
    expect(log).toMatch(/\[bootloader\]/);
    expect(log).toMatch(/Kernel: VoidOS/);
    expect($('boot').hidden).toBe(true);
    expect(document.querySelectorAll('.vo-icon').length).toBe(10);
  });

  it('files written in the terminal survive reboot AND a full page reload (IndexedDB)', async () => {
    await loadPage();
    await openTerminal();
    enter(terminalInput(), 'write /home/user/keep.txt "still here"');
    enter(terminalInput(), 'reboot');
    await vi.waitFor(() => expect($('desktop-root').hidden).toBe(true), T); // old desktop is gone...
    await vi.waitFor(() => expect($('desktop-root').hidden).toBe(false), T); // ...and the rebooted one is up
    unlock();
    // session restore re-opened the terminal after the reboot
    await vi.waitFor(() => expect(terminalInput()).toBeTruthy(), T);
    enter(terminalInput(), 'cat /home/user/keep.txt');
    expect(document.querySelector('.term-out').textContent).toContain('still here');

    enter(terminalInput(), 'shutdown');
    await vi.waitFor(() => expect($('desktop-root').hidden).toBe(true), T);
    expect($('boot-log').textContent).toMatch(/Máy đã tắt/);

    // "reload the page": brand-new module instance, same IndexedDB
    await loadPage();
    expect($('boot-log').textContent).not.toMatch(/No bootable system/);
    await vi.waitFor(() => expect(terminalInput()).toBeTruthy(), T);
    enter(terminalInput(), 'cat /home/user/keep.txt');
    expect(document.querySelector('.term-out').textContent).toContain('still here');
  });

  it('a damaged kernel stops the boot with a message and a retry button', async () => {
    await loadPage();
    await openTerminal();
    enter(terminalInput(), 'write /boot/kernel.vx garbage');
    enter(terminalInput(), 'reboot');
    await vi.waitFor(() => expect($('boot-log').textContent).toMatch(/Kernel panic|Bootloader stopped/), T);
    await vi.waitFor(() => expect($('power').textContent).toMatch(/Thử lại/), T);
    expect($('desktop-root').hidden).toBe(true);
    expect($('power').disabled).toBe(false);
    // the retry boots the damaged kernel again; repair it first through a fresh disk handle is out of scope,
    // so just check the failure is stable (no exception, no hang)
    $('power').click();
    await vi.waitFor(() => expect($('power').textContent).toMatch(/Thử lại/), T);
  });
});
