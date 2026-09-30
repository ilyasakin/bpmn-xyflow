/**
 * Minimal command stack with undo/redo.
 *
 * A command is `{ name, do, undo, payload? }`. Calling execute(cmd) runs
 * cmd.do() and pushes it onto the stack, dropping any pending redo
 * entries. undo() pops one and runs cmd.undo(); redo() re-applies it.
 */
export default function CommandStack(opts = {}) {
  const undoStack = [];
  const redoStack = [];
  const limit = opts.limit ?? 200;
  const listeners = new Set();

  function emit() {
    listeners.forEach(l => {
      try { l({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 }); } catch (e) { console.error(e); }
    });
  }

  // Compound transactions ////////
  // While `compoundDepth > 0`, individual `execute(cmd)` calls run
  // `cmd.do()` immediately but accumulate into `compoundBuffer` instead
  // of pushing onto the undo stack. `compound(name, fn)` opens a
  // transaction, runs `fn`, then pushes ONE composite command.
  let compoundDepth = 0;
  let compoundBuffer = null;

  function applyChildren(children, method, rollback) {
    const completed = [];
    try {
      children.forEach(command => { command[method](); completed.push(command); });
    } catch (error) {
      // A command must itself be atomic; unwind every completed sibling
      // so a failing composite redo/undo remains at its prior savepoint.
      completed.reverse().forEach(command => command[rollback]());
      throw error;
    }
  }

  function execute(cmd) {
    cmd.do();
    if (compoundDepth > 0) {
      compoundBuffer.push(cmd);
      return;
    }
    undoStack.push(cmd);
    if (undoStack.length > limit) undoStack.shift();
    redoStack.length = 0;
    emit();
  }

  /**
   * Run `fn` and treat every command it executes as a single undo
   * step. If `fn` runs no commands, no entry is pushed. Nested
   * compounds collapse into the outermost one.
   */
  function compound(name, fn) {
    if (compoundDepth === 0) compoundBuffer = [];
    const start = compoundBuffer.length;
    compoundDepth += 1;
    let result;
    try {
      result = fn();
    } catch (error) {
      // Roll back only this transaction's successful children. This also
      // gives a nested transaction a savepoint if its caller catches it.
      const children = compoundBuffer.splice(start);
      for (const command of children.reverse()) command.undo();
      throw error;
    } finally {
      compoundDepth -= 1;
      if (compoundDepth === 0) {
        const children = compoundBuffer;
        compoundBuffer = null;
        if (children.length) {
          undoStack.push({
            name: name || 'compound',
            do: () => applyChildren(children, 'do', 'undo'),
            undo: () => applyChildren(children.slice().reverse(), 'undo', 'do'),
            children
          });
          if (undoStack.length > limit) undoStack.shift();
          redoStack.length = 0;
          emit();
        }
      }
    }
    return result;
  }

  function undo() {
    const cmd = undoStack[undoStack.length - 1];
    if (!cmd) return false;
    cmd.undo();
    undoStack.pop();
    redoStack.push(cmd);
    emit();
    return true;
  }

  function redo() {
    const cmd = redoStack[redoStack.length - 1];
    if (!cmd) return false;
    cmd.do();
    redoStack.pop();
    undoStack.push(cmd);
    emit();
    return true;
  }

  function clear() {
    undoStack.length = 0;
    redoStack.length = 0;
    emit();
  }

  function onChange(handler) {
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  /**
   * Snapshot the current undo/redo state so it can later be restored
   * — used by drill-in/back navigation to give each level its own
   * history. The snapshot is opaque; pass it back into restore().
   */
  function snapshot() {
    return { undo: undoStack.slice(), redo: redoStack.slice() };
  }

  function restore(snap) {
    undoStack.length = 0;
    redoStack.length = 0;
    if (snap && Array.isArray(snap.undo)) snap.undo.forEach(c => undoStack.push(c));
    if (snap && Array.isArray(snap.redo)) snap.redo.forEach(c => redoStack.push(c));
    emit();
  }

  return {
    execute, undo, redo, clear, onChange, snapshot, restore, compound,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    size: () => undoStack.length
  };
}
