const forwarded = new WeakSet();
export const isForwardedKey = event => forwarded.has(event);

export function cloneInput(input) {
  const copy = Object.assign(Object.create(Object.getPrototypeOf(input)), input);
  for (const key of ['keyBuffer', 'prefixRepeat', 'motionRepeat']) if (input[key]) copy[key] = [...input[key]];
  for (const key of ['motionArgs', 'operatorArgs']) if (input[key]) copy[key] = { ...input[key] };
  return copy;
}

/** Wait only at prefixes owned by this extension. The original dispatcher
 * remains the authority for both matching and the shorter fallback mapping. */
export function prefixWait({ lookup, timeoutMs, isCurrent, getEvent = () => null }) {
  const pending = new Map();
  let forwarding = false;
  const selection = cm => JSON.stringify(cm.listSelections());
  const owns = (cm, p) => cm.state.vim === p.vim && p.vim.inputState === p.input && p.input.keyBuffer.join('') === p.buffer;
  function valid(cm, p) {
    return owns(cm, p) && isCurrent(cm) && cm.getValue() === p.text &&
      (!p.doc || cm.cm6?.state.doc === p.doc) && selection(cm) === p.selection &&
      p.vim.insertMode === p.insertMode && p.vim.visualMode === p.visualMode &&
      (!p.document || p.document.activeElement === p.focus);
  }
  function remove(cm) {
    const p = pending.get(cm);
    if (p) clearTimeout(p.timer);
    pending.delete(cm);
    return p;
  }
  function cancel(cm) {
    const p = remove(cm);
    if (p && owns(cm, p)) p.vim.inputState = new p.input.constructor();
  }
  function fallback(cm, p) {
    cm.state.vim.inputState = cloneInput(p.before);
    return lookup(cm, p.key, p.origin)?.();
  }
  function handoff(event) {
    if (!event?.target?.dispatchEvent) return false;
    const doc = event.target.ownerDocument;
    const target = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : event.target;
    if (!target.isConnected) return false;
    const copy = new doc.defaultView.KeyboardEvent(event.type, {
      key: event.key, code: event.code, location: event.location, repeat: event.repeat,
      ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey,
      keyCode: event.keyCode, which: event.which, bubbles: true, cancelable: true, composed: true,
    });
    let stopped = false;
    for (const name of ['stopPropagation', 'stopImmediatePropagation']) {
      const original = copy[name];
      copy[name] = function () { stopped = true; return original.call(this); };
    }
    forwarded.add(copy);
    forwarding = true;
    try { target.dispatchEvent(copy); } finally { forwarding = false; }
    return copy.defaultPrevented || stopped;
  }
  return {
    get forwarding() { return forwarding; },
    defer(cm, key, origin) {
      const vim = cm.state.vim, input = vim.inputState;
      const event = origin === 'user' ? getEvent(cm) : null;
      const p = {
        vim, input, before: cloneInput(input), key, origin,
        text: cm.getValue(), doc: cm.cm6?.state.doc, selection: selection(cm),
        insertMode: vim.insertMode, visualMode: vim.visualMode,
        document: event?.target?.ownerDocument,
        deadline: timeoutMs ? Date.now() + timeoutMs : Infinity,
      };
      p.focus = p.document?.activeElement;
      input.keyBuffer.push(key);
      p.buffer = input.keyBuffer.join('');
      pending.set(cm, p);
      if (timeoutMs) p.timer = setTimeout(() => {
        if (pending.get(cm) !== p) return;
        if (!valid(cm, p)) { cancel(cm); return; }
        remove(cm);
        fallback(cm, p);
      }, timeoutMs);
      return () => true;
    },
    resolve(cm, key, origin) {
      const p = pending.get(cm);
      if (!p) return null;
      if (['<Esc>', '<C-c>', '<C-[>'].includes(key) || !valid(cm, p)) {
        cancel(cm);
        return null;
      }
      remove(cm);
      if (Date.now() < p.deadline) {
        const handler = lookup(cm, key, origin);
        // Supported Vim engines replace InputState on a failed lookup; full
        // and partial matches retain it until their handler is executed.
        if (cm.state.vim.inputState === p.input) return { handler };
      }
      const event = origin === 'user' ? getEvent(cm) : null;
      return { handler: () => {
        fallback(cm, p);
        // A shorter command may open a new host key listener. Offer it the
        // remaining physical key without entering Vim twice.
        if (handoff(event)) return true;
        // Preserve an unhandled result so the original physical event can
        // insert text after native substitution enters insert mode.
        return lookup(cm, key, origin)?.();
      } };
    },
    cancelAll() { for (const cm of pending.keys()) cancel(cm); },
    hasPending: cm => pending.has(cm),
  };
}
