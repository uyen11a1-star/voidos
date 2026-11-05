import { openTerminal } from '../applications/terminal.js';
import { openFileManager } from '../applications/file-manager.js';
import { openEditor } from '../applications/text-editor.js';
import { openMonitor } from '../applications/system-monitor.js';
import { openSettings } from '../applications/settings.js';
import { openBrowser } from '../applications/browser.js';
import { openMusic } from '../applications/music.js';
import { openPhotos } from '../applications/photos.js';
import { openCalculator } from '../applications/calculator.js';

// Built-in applications (ids are reserved: installed programs cannot reuse them). icon = id in icons.js.
export const BUILTIN_APPS = [
  { id: 'browser', name: 'Trình duyệt', icon: 'browser', open: openBrowser },
  { id: 'files', name: 'Tệp', icon: 'files', open: openFileManager },
  { id: 'music', name: 'Âm nhạc', icon: 'music', open: openMusic },
  { id: 'photos', name: 'Ảnh', icon: 'photos', open: openPhotos },
  { id: 'terminal', name: 'Terminal', icon: 'terminal', open: openTerminal },
  { id: 'editor', name: 'Soạn thảo', icon: 'editor', open: openEditor },
  { id: 'calculator', name: 'Máy tính', icon: 'calculator', open: openCalculator },
  { id: 'monitor', name: 'Giám sát', icon: 'monitor', open: openMonitor },
  { id: 'settings', name: 'Cài đặt', icon: 'settings', open: openSettings },
];
