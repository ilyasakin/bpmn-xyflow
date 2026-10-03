/** Passive pre-command reference oracle for the separately registered follow-up cases. */
import assert from "node:assert/strict";

export async function observeReferenceConnection(page, prefix) {
  await page.evaluate((prefix) => {
    if (window.anchorFollowupObservation) throw new Error("Unclosed reference observation");
    const modeler = window.referenceModeler,
      eventBus = modeler.get("eventBus"),
      events = [];
    if (!["connect", "bendpoint.move"].includes(prefix))
      throw new Error("Unsupported reference gesture");
    const names = [prefix + ".move", prefix + ".end"];
    const originalRoutes = new WeakMap();
    const copyPoint = (point) =>
      point && {
        ...point,
        ...(point.original ? { original: { ...point.original } } : {}),
      };
    const rememberRoute = (event) => {
      if (event.context.connection)
        originalRoutes.set(event.context, event.context.connection.waypoints.map(copyPoint));
    };
    eventBus.on(prefix + ".start", 20000, rememberRoute);
    const rawEvents = new WeakMap(),
      bpmnSnaps = new WeakMap();
    const rawListener = (event) => {
      rawEvents.set(event.context, {
        x: event.x,
        y: event.y,
        start: copyPoint(event.context.connectionStart),
      });
    };
    eventBus.on(names, 20000, rawListener);
    const bpmnListener = (event) => {
      bpmnSnaps.set(event.context, {
        point: { x: event.x, y: event.y },
        snapped: { x: !!event.snapped?.x, y: !!event.snapped?.y },
      });
    };
    eventBus.on(names, 1240, bpmnListener);
    const listener = (event) => {
      const context = event.context;
      const record = {
        type: event.type,
        x: event.x,
        y: event.y,
        raw: rawEvents.get(context),
        bpmnSnap: bpmnSnaps.get(context),
        grid: {
          active: modeler.get("gridSnapping").isActive(),
          spacing: modeler.get("gridSnapping").getGridSpacing(),
        },
        snapped: { x: !!event.snapped?.x, y: !!event.snapped?.y },
        start: copyPoint(context.connectionStart),
        source: context.source?.id,
        target: context.target?.id,
        hover: context.hover?.id,
        original: event.originalEvent
          ? {
              type: event.originalEvent.type,
              trusted: event.originalEvent.isTrusted,
              x: event.originalEvent.clientX,
              y: event.originalEvent.clientY,
              ctrlKey: event.originalEvent.ctrlKey,
              metaKey: event.originalEvent.metaKey,
            }
          : null,
      };
      events.push(record);
      if (
        event.type !== prefix + ".end" ||
        !context.source ||
        !context.target ||
        !(prefix === "connect" ? context.canExecute : context.allowed)
      )
        return;
      try {
        const type =
          prefix === "connect"
            ? context.canExecute.type
            : context.allowed.type || context.connection.type;
        if (!["bpmn:SequenceFlow", "bpmn:MessageFlow"].includes(type))
          throw new Error("Unexpected Batch B reference connection type: " + type);
        const shapes = new Map();
        const shape = (element) => {
          if (!shapes.has(element))
            shapes.set(element, {
              ...element,
              // Graph model semantic/DI links are non-enumerable accessors.
              businessObject: element.businessObject,
              di: element.di,
              type: element.type,
              parent: element.parent,
              host: element.host,
            });
          return shapes.get(element);
        };
        const source = shape(context.source),
          target = shape(context.target),
          existing = prefix === "connect" ? undefined : originalRoutes.get(context)?.map(copyPoint);
        if (prefix !== "connect" && !existing?.length)
          throw new Error("Missing original pre-drag route");
        // The installed moddle prototype supplies the real type hierarchy. No
        // semantic element is allocated or attached to the live reference model.
        const connection = {
          type,
          businessObject: Object.create(modeler.get("moddle").getType(type).prototype),
          source,
          target,
          waypoints: existing,
        };
        let hints;
        if (prefix === "connect") {
          const reverse = context.hover === context.source && context.source !== context.target;
          const end = { x: event.x, y: event.y };
          hints = {
            connectionStart: copyPoint(reverse ? end : context.connectionStart),
            connectionEnd: copyPoint(reverse ? context.connectionStart : end),
          };
        } else {
          const reverse =
            context.type === "reconnectStart"
              ? context.hover === context.target && context.source !== context.target
              : context.hover === context.source && context.source !== context.target;
          const startChanged = (context.type === "reconnectStart") !== reverse;
          hints = {
            [startChanged ? "connectionStart" : "connectionEnd"]: {
              x: Math.round(event.x),
              y: Math.round(event.y),
            },
          };
          if (reverse) hints.waypoints = existing.slice().reverse();
        }
        record.expectedInput = {
          type,
          originalType: context.connection?.type,
          reverse: context.hover === context.source && context.source !== context.target,
          boundaryToHost: !!source.host && source.host.id === target.id,
          source: {
            id: source.id,
            type: source.type,
            types: ["bpmn:Event", "bpmn:Gateway", "bpmn:Task", "bpmn:SubProcess"].filter((t) =>
              source.businessObject.$instanceOf(t),
            ),
            x: source.x,
            y: source.y,
            width: source.width,
            height: source.height,
          },
          target: {
            id: target.id,
            type: target.type,
            types: ["bpmn:Event", "bpmn:Gateway", "bpmn:Task", "bpmn:SubProcess"].filter((t) =>
              target.businessObject.$instanceOf(t),
            ),
            x: target.x,
            y: target.y,
            width: target.width,
            height: target.height,
          },
          beforeWaypoints: existing,
          hints,
        };
        connection.waypoints = modeler.get("layouter").layoutConnection(connection, hints);
        record.expectedRoute = modeler
          .get("connectionDocking")
          .getCroppedWaypoints(connection)
          .map(({ x, y }) => ({ x, y }));
      } catch (error) {
        record.oracleError = error.message;
      }
    };
    eventBus.on(names, 1100, listener);
    window.anchorFollowupObservation = {
      events,
      remove: () => {
        eventBus.off(names, listener);
        eventBus.off(names, rawListener);
        eventBus.off(names, bpmnListener);
        eventBus.off(prefix + ".start", rememberRoute);
      },
    };
  }, prefix);
}
export async function finishReferenceConnection(page) {
  return page.evaluate(() => {
    const observation = window.anchorFollowupObservation;
    if (!observation) return [];
    observation.remove();
    delete window.anchorFollowupObservation;
    return observation.events;
  });
}
export function assertReferenceConnectionRoute(h, edge, event) {
  assert.ok(
    event && Number.isFinite(event.x) && Number.isFinite(event.y),
    "actual post-snapping event coordinates",
  );
  assert.equal(event.oracleError, undefined, "reference reconstruction succeeds before commit");
  assert.ok(event.expectedInput && event.expectedRoute?.length >= 2);
  if (event.type === "connect.end") assertReferenceCreateSnapping(event);
  assert.equal(
    edge.type,
    event.expectedInput.type,
    "reference semantic type matches the prospective rule result",
  );
  assert.equal(event.expectedInput.source.id, edge.source);
  assert.equal(event.expectedInput.target.id, edge.target);
  assert.equal(
    edge.points.length,
    event.expectedRoute.length,
    "reference route topology follows independently observed pre-command inputs",
  );
  edge.points.forEach((point, index) =>
    h.near(
      point,
      event.expectedRoute[index],
      1e-7,
      "reference chosen docking and route follow the complete snapped layout/cropping policy",
    ),
  );
}

/** Independent source-derived BPMN1250 and default Grid1200 policy. */
export function assertReferenceCreateSnapping(event) {
  const { source, target, type, reverse, boundaryToHost } = event.expectedInput;
  assert.equal(reverse, false, "these authored reference creations use their declared direction");
  assert.equal(boundaryToHost, false, "boundary-to-own-host has a separate reference policy");
  assert.ok(
    !event.original.ctrlKey && !event.original.metaKey,
    "these creation cases use default snapping without a modifier",
  );
  const mid = (shape) => ({
    x: Math.round(shape.x + shape.width / 2),
    y: Math.round(shape.y + shape.height / 2),
  });
  const p = { x: event.raw.x, y: event.raw.y },
    snapped = { x: false, y: false },
    task = target.types.includes("bpmn:Task"),
    padding = task ? 10 : 20;
  const snap = (axis, value) => {
    p[axis] = value;
    snapped[axis] = true;
  };
  for (const [axis, size] of [
    ["x", "width"],
    ["y", "height"],
  ]) {
    if (p[axis] < target[axis] + padding) snap(axis, target[axis] + padding);
    else if (p[axis] > target[axis] + target[size] - padding)
      snap(axis, target[axis] + target[size] - padding);
  }
  let start = event.raw.start;
  if (type === "bpmn:SequenceFlow") {
    start = mid(source);
    if (target.types.includes("bpmn:Event") || target.types.includes("bpmn:Gateway")) {
      const center = mid(target);
      snap("x", center.x);
      snap("y", center.y);
    } else if (task || target.types.includes("bpmn:SubProcess")) {
      for (const [axis, size] of [
        ["x", "width"],
        ["y", "height"],
      ])
        if (p[axis] > target[axis] + 20 && p[axis] < target[axis] + target[size] - 20)
          snap(axis, mid(target)[axis]);
    }
  } else {
    assert.equal(type, "bpmn:MessageFlow");
    if (source.types.includes("bpmn:Event")) start = mid(source);
    if (target.types.includes("bpmn:Event")) {
      const center = mid(target);
      snap("x", center.x);
      snap("y", center.y);
    }
  }
  assert.deepEqual(
    event.bpmnSnap,
    { point: p, snapped },
    "actual BPMN snapping matches its independently derived shape policy",
  );
  assert.deepEqual(
    event.start,
    start,
    "source docking hint follows the declared reference source policy",
  );
  assert.equal(event.grid.spacing, 10);
  for (const axis of ["x", "y"])
    if (event.grid.active && !snapped[axis]) p[axis] = Math.round(p[axis] / 10) * 10;
  assert.deepEqual(
    { x: event.x, y: event.y },
    p,
    "only the remaining unsnapped axes reach the default ten-unit grid",
  );
}
