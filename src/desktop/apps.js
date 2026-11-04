import { openTerminal } from '../applications/terminal.js';
import { openFileManager } from '../applications/file-manager.js';
import { openEditor } from '../applications/text-editor.js';
import { openMonitor } from '../applications/system-monitor.js';
import { openSettings } from '../applications/settings.js';

// Built-in applications (ids are reserved: installed programs cannot reuse them).
export const BUILTIN_APPS = [
  { id: 'terminal', name: 'Terminal', icon: '⌨️', open: openTerminal },
  { id: 'files', name: 'Tệp', icon: '📁', open: openFileManager },
  { id: 'editor', name: 'Soạn thảo', icon: '📝', open: openEditor },
  { id: 'monitor', name: 'Giám sát', icon: '📊', open: openMonitor },
  { id: 'settings', name: 'Cài đặt', icon: '⚙️', open: openSettings },
];
