// Importa en segundo plano para no congelar la pantalla en computadores lentos.

import { importGedcom } from './import';

self.onmessage = async (e: MessageEvent<File>) => {
  try {
    const text = await e.data.text();
    self.postMessage({ ok: true, tree: importGedcom(text) });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) });
  }
};
