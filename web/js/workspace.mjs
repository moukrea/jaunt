// The persisted tree contains session IDs and ratios only, never terminal contents.
export function leaves(tree) { return !tree ? [] : tree.id ? [tree.id] : [...leaves(tree.first), ...leaves(tree.second)]; }
export function prune(tree, ids) {
  if (!tree) return null;
  if (tree.id) return ids.has(tree.id) ? {id: tree.id} : null;
  const first = prune(tree.first, ids), second = prune(tree.second, ids);
  return first && second ? {axis: tree.axis === 'y' ? 'y' : 'x', ratio: Math.max(.15, Math.min(.85, Number(tree.ratio) || .5)), first, second} : first || second;
}
export function split(tree, target, id, axis = 'x') {
  if (!tree || leaves(tree).includes(id)) return tree;
  if (tree.id) return tree.id === target ? {axis, ratio: .5, first: tree, second: {id}} : tree;
  return {...tree, first: split(tree.first, target, id, axis), second: split(tree.second, target, id, axis)};
}
export function themeMode(mode = 'dark', hour = new Date().getHours(), systemLight = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches) {
  return mode === 'light' || mode === 'system' && systemLight || mode === 'circadian' && hour >= 7 && hour < 19 ? 'light' : 'dark';
}
