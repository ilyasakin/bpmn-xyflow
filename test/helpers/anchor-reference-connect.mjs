/** Passive reference evidence: no command or live-model mutation occurs here. */
export function observeReferenceConnect(modeler) {
  const bus = modeler.get("eventBus"),
    events = [],
    listeners = [];
  const xy = (p) => p && { x: p.x, y: p.y };
  const on = (name, priority, listener) => {
    bus.on(name, priority, listener);
    listeners.push([name, listener]);
  };
  for (const [phase, priority] of [
    ["raw", 1300],
    ["post-bpmn", 1240],
    ["post-grid", 1100],
  ]) {
    on(["connect.move", "connect.end"], priority, (event) => {
      const context = event.context;
      const record = {
        phase,
        type: event.type,
        point: xy(event),
        start: xy(context.connectionStart),
        source: context.source?.id,
        target: context.target?.id,
        snapped: { x: !!event.snapped?.x, y: !!event.snapped?.y },
        input: event.originalEvent && {
          type: event.originalEvent.type,
          trusted: event.originalEvent.isTrusted,
          x: event.originalEvent.clientX,
          y: event.originalEvent.clientY,
        },
      };
      events.push(record);
      if (phase !== "post-grid" || event.type !== "connect.end" || !context.canExecute) return;
      try {
        const type = context.canExecute.type;
        if (type !== "bpmn:SequenceFlow")
          throw new Error("This oracle covers the authored Task SequenceFlow cases");
        const source = { ...context.source },
          target = { ...context.target };
        if (
          source.type !== "bpmn:Task" ||
          target.type !== "bpmn:Task" ||
          source.waypoints ||
          target.waypoints
        )
          throw new Error("The reference case requires two Task shapes");
        const reverse = context.hover === context.source && context.source !== context.target;
        const hints = {
          connectionStart: xy(reverse ? event : context.connectionStart),
          connectionEnd: xy(reverse ? context.connectionStart : event),
        };
        const connection = {
          type,
          source,
          target,
          businessObject: Object.create(modeler.get("moddle").getType(type).prototype),
        };
        record.hints = hints;
        connection.waypoints = modeler.get("layouter").layoutConnection(connection, hints);
        record.expectedRoute = modeler
          .get("connectionDocking")
          .getCroppedWaypoints(connection)
          .map(xy);
      } catch (error) {
        record.oracleError = error.message;
      }
    });
  }
  on("contextPad.trigger", 20000, (event) => {
    const e = event.event;
    events.push({
      phase: "context",
      type: e.type,
      action: e.target?.closest?.("[data-action]")?.getAttribute("data-action"),
      input: { trusted: e.isTrusted, x: e.clientX, y: e.clientY },
    });
  });
  on("commandStack.connection.create.preExecute", 20000, (event) => {
    const c = event.context;
    events.push({
      phase: "command",
      source: c.source?.id,
      target: c.target?.id,
      hints: {
        connectionStart: xy(c.hints?.connectionStart),
        connectionEnd: xy(c.hints?.connectionEnd),
      },
    });
  });
  return {
    events,
    clear() {
      events.length = 0;
    },
    destroy() {
      for (const [name, listener] of listeners) bus.off(name, listener);
    },
  };
}
