---
name: SolidJS store proxy pitfalls
description: Solid stores produce() breaks when recursive functions mix proxy and plain objects in returned trees; fix with unwrap+structuredClone+reconcile. Also, onClick uses event delegation (e.currentTarget is document); use on:click for native binding.
type: feedback
---

When modifying deeply nested SolidJS store trees (like the PaneLayout tree in store.ts), avoid using `produce()` to reassign a property to a new object tree built by a recursive function. The recursive function may receive store proxy references and embed them into new plain objects, creating mixed proxy/plain trees that break fine-grained reactivity.

**Why:** In jaunt's terminal workspace, `splitPane` and `closePane` used `produce` to replace `t.panes` with a recursively-built tree. The first operation worked but subsequent ones failed silently because the store couldn't properly track/diff the mixed proxy/plain tree.

**How to apply:**
1. Before recursively transforming store data: `const raw = structuredClone(unwrap(storeValue))`
2. Process the plain object tree with pure functions
3. Set it back with `reconcile()`: `setStore('path', reconcile(newTree))`

Also: SolidJS `onClick` uses event delegation (listener on document root), meaning `e.currentTarget` is the document, not the element. Use `on:click` for native (non-delegated) binding when you need `e.currentTarget` to be the actual element (e.g., for dispatching CustomEvents from buttons containing SVG children).
