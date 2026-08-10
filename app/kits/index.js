// Kit registry. A kit is a sparkle species over the shared field substrate:
// it owns its parameters, its per-particle properties, and its draw call, and
// nothing else. `ascii` and `bokeh` land in M5 — see glitterizer.md §2, §8.

import * as blingee from './blingee.js';

export const kits = {
  [blingee.id]: blingee
};

export function getKit(id) {
  return kits[id] || blingee;
}
