// Project files. The document, not a render: source image, painted fields,
// parameters, and the seed. See glitterizer.md §5.

import { downloadBlob, stamp } from './download.js';

export function saveProject(doc, baseCanvas) {
  const json = JSON.stringify(doc.serialize(baseCanvas));
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `${stamp('glitterizer')}.json`);
  return blob.size;
}

export async function readProjectFile(file) {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('That file is not readable JSON.');
  }
}
