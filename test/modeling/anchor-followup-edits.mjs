/** Batch A. Prepared UI-only acceptance cases; importing this module runs nothing. */
import assert from "node:assert/strict";
import { assertOnlyAnchorGeometry } from "../helpers/anchor-model-guard.mjs";
import {
  assertMessageConversion,
  assertReferenceMessageConversion,
  assertReferenceConnectionUndo,
  assertDataChange,
  assertDeletedClosure,
} from "../helpers/anchor-followup-model.mjs";
import {
  endpoint,
  redock,
  visibleControl,
  connectNative,
  continuingPort,
  saveFollowupEvidence,
} from "../helpers/anchor-followup-controls.mjs";
import { selectedBendpoint } from "../helpers/native-bendpoint-control.mjs";
const order = "Order, payment and delivery",
  approval = "Approval, rejection and rework";
export const anchorEditCases = [];
const add = (id, name, sample, run, engine = "local") =>
  anchorEditCases.push({ id, name, sample, engine, run });

for (const engine of ["local", "upstream"])
  add(
    "F17-M",
    "message-conversion-and-rejection",
    order,
    async (h, page) => {
      const original = await h.state(page),
        from = await endpoint(h, page, "OrderMessage", "target");
      const invalid = h.screen(original, h.side(h.node(original, "FulfillmentFork"), "top"));
      assert.ok((await h.hit(page, invalid)).owners.includes("FulfillmentFork"));
      let invalidPreview, invalidActivation;
      await h.drag(page, from, invalid, {
        capture: async () => {
          if (engine === "upstream") {
            invalidActivation = await page.evaluate(() => {
              const state = window.referenceModeler.get("dragging").context();
              return {
                active: !!state?.active,
                prefix: state?.prefix,
                allowed: state?.data?.context?.allowed,
              };
            });
            assert.deepEqual(invalidActivation, {
              active: true,
              prefix: "bendpoint.move",
              allowed: false,
            });
            invalidPreview = await h.preview(page);
            assert.ok(
              invalidPreview?.length > 0,
              "rejected reference reconnect still shows an activated detached preview",
            );
          } else {
            const live = await h.state(page),
              edge = live.edges.OrderMessage;
            assert.notDeepEqual(
              edge.points,
              original.edges.OrderMessage.points,
              "rejected local reconnect was genuinely activated",
            );
            assert.deepEqual(
              [edge.source, edge.target],
              [original.edges.OrderMessage.source, original.edges.OrderMessage.target],
            );
            assert.deepEqual(live.history, original.history);
            invalidPreview = await h.renderEnds(page, "OrderMessage");
            const input = live.input.findLast((e) => e.type === "mousemove");
            assert.equal(input?.trusted, true);
            h.near(
              invalidPreview.end,
              { x: input.x, y: input.y },
              0.05,
              "invalid preview follows the delivered pointer",
            );
            invalidActivation = { active: true, changedRoute: true, input };
          }
          await saveFollowupEvidence(h, page, "invalid-reconnect-preview", {
            invalidActivation,
            invalidPreview,
          });
        },
      });
      await h.noChange(page, original, "cross-pool gateway rejects message reconnect");
      const change = await redock(
        h,
        page,
        "OrderMessage",
        "target",
        "ReceiveDelivery",
        "left",
        0.25,
      );
      assert.equal(change.edge.type, "bpmn:SequenceFlow");
      assert.equal(change.edge.source, "SubmitOrder");
      assert.equal(change.edge.target, "ReceiveDelivery");
      assert.equal(change.edge.owner, "BuyerProcess");
      if (engine === "local") {
        assert.equal(change.edge.id, "OrderMessage");
        await assertMessageConversion(
          change.before.xml,
          change.after.xml,
          "OrderMessage",
          "ReceiveDelivery",
        );
        await h.history(page, change.before, change.after);
      } else {
        assert.notEqual(change.edge.id, "OrderMessage");
        assert.equal(change.after.edges.OrderMessage, undefined);
        await assertReferenceMessageConversion(
          change.before.xml,
          change.after.xml,
          "OrderMessage",
          change.edge.id,
          "ReceiveDelivery",
        );
        const label = change.before.nodes.find((n) => n.id === "OrderMessage_label");
        assert.ok(label);
        const labelBounds = Object.fromEntries(
          ["x", "y", "width", "height"].map((k) => [k, label[k]]),
        );
        await h.clickButton(page, "#undo-btn");
        await assertReferenceConnectionUndo(change.before.xml, (await h.state(page)).xml, {
          operation: "message-conversion",
          connectionId: "OrderMessage",
          labelBounds,
        });
        await h.clickButton(page, "#redo-btn");
        assert.equal((await h.state(page)).xml, change.after.xml);
      }
      return {
        before: change.before.edges.OrderMessage,
        after: change.edge,
        release: change.release,
        preview: change.preview,
        reference: change.observation,
        invalidActivation,
        invalidPreview,
      };
    },
    engine,
  );

add("F17-D", "data-source-and-owner-reconnect", order, async (h, page) => {
  let s = await h.state(page);
  const dataA = await h.palette(page, "Data object", h.screen(s, { x: 1050, y: 610 }));
  s = await h.state(page);
  const dataB = await h.palette(page, "Data object", h.screen(s, { x: 1180, y: 610 }));
  const made = await connectNative(h, page, dataA, "ValidateOrder", {
    side: "left",
    targetSide: "bottom",
    expectedType: "bpmn:DataInputAssociation",
  });
  assert.equal(made.edge.type, "bpmn:DataInputAssociation");
  await assertDataChange(made.before.xml, made.after.xml, made.edge.id, {
    mode: "create",
    dataId: dataA,
    ownerId: "ValidateOrder",
  });
  await h.history(page, made.before, made.after);
  const source = await redock(h, page, made.edge.id, "source", dataB, "left");
  await assertDataChange(source.before.xml, source.after.xml, made.edge.id, {
    mode: "source",
    dataId: dataB,
    ownerId: "ValidateOrder",
  });
  assert.equal(source.after.edges[made.edge.id].target, source.before.edges[made.edge.id].target);
  await h.history(page, source.before, source.after);
  const owner = await redock(h, page, made.edge.id, "target", "PackOrder", "bottom");
  await assertDataChange(owner.before.xml, owner.after.xml, made.edge.id, {
    mode: "owner",
    dataId: dataB,
    ownerId: "PackOrder",
  });
  await h.history(page, owner.before, owner.after);
  return {
    created: made.edge,
    source: source.after.edges[made.edge.id],
    owner: owner.after.edges[made.edge.id],
  };
});

for (const mode of ["bend", "segment"])
  for (const selected of [true, false])
    add(
      mode === "bend" ? "F18-B" : "F18-S",
      `${mode}-${selected ? "selected" : "other-selected-hover"}`,
      approval,
      async (h, page) => {
        const id = "ReworkFlow";
        if (selected) await h.chooseEdge(page, id);
        else await h.chooseEdge(page, "ReviewFlow");
        const before = await h.state(page),
          edge = before.edges[id],
          index = 1;
        const point =
          mode === "bend"
            ? edge.points[index]
            : { x: (edge.points[index].x + edge.points[index + 1].x) / 2, y: edge.points[index].y };
        const approach = h.screen(before, point);
        await page.mouse.move(approach.x, approach.y, { steps: 8 });
        await h.settle(page);
        const selector =
          mode === "bend"
            ? `${selected ? ".bpmn-xyflow-bendpoints .bpmn-xyflow-bendpoint" : ".bpmn-xyflow-hover-bendpoint"}[data-element-id="${id}"][data-bend-index="${index}"]`
            : `${selected ? ".bpmn-xyflow-segment-handle" : ".bpmn-xyflow-hover-segment"}[data-element-id="${id}"][data-segment-index="${index}"]`;
        const start =
          mode === "bend" && selected
            ? await selectedBendpoint(page, id, index)
            : await visibleControl(page, selector, {
                owner: id,
                index,
                indexAttribute: mode === "bend" ? "data-bend-index" : "data-segment-index",
              });
        await saveFollowupEvidence(h, page, "route-before", { id, mode, index, start, edge });
        let preview;
        await h.drag(
          page,
          start,
          { x: start.x + (mode === "bend" ? 36 : 0), y: start.y + 44 },
          {
            capture: async () => {
              preview = await h.renderEnds(page, id);
              await saveFollowupEvidence(h, page, "route-preview", { id, mode, preview });
            },
          },
        );
        const after = await h.state(page),
          points = after.edges[id].points;
        await saveFollowupEvidence(h, page, "route-after", { id, mode, points, preview });
        assert.notDeepEqual(points, edge.points, "the requested control actually edits its route");
        assert.deepEqual(
          points.at(-1),
          edge.points.at(-1),
          "the unaffected opposite end remains exact",
        );
        if (mode === "segment") assert.deepEqual(points[0], edge.points[0]);
        const release = after.input.findLast((event) => event.type === "mouseup");
        assert.equal(release?.trusted, true);
        if (mode === "bend")
          h.near(
            points[index],
            release.graphPoint,
            0.05 / after.viewport.zoom,
            "the chosen bend follows delivered input",
          );
        else
          assert.ok(
            points.some(
              (p, i) =>
                i > 0 &&
                p.y === points[i - 1].y &&
                Math.abs(h.screen(after, p).y - start.y - 44) < 1.5,
            ),
            "the visible parallel segment follows the chosen offset",
          );
        await assertOnlyAnchorGeometry(before.xml, after.xml, { edgeIds: [id] });
        const rendered = await h.renderEnds(page, id);
        h.near(preview.start, rendered.start, 0.05, "edited preview source");
        h.near(preview.end, rendered.end, 0.05, "edited preview target");
        await h.history(page, before, after);
        return { before: edge, after: after.edges[id], preview, rendered, selected };
      },
    );

for (const kind of ["edge", "node"])
  add(
    kind === "edge" ? "F21-E" : "F21-N",
    `delete-${kind}-with-label`,
    approval,
    async (h, page) => {
      const id = kind === "edge" ? "ApproveFlow" : "ReworkRequest",
        removed = kind === "edge" ? [id] : [id, "RejectFlow", "ReworkFlow"];
      if (kind === "edge") await h.chooseEdge(page, id);
      else await h.selectNode(page, id);
      const before = await h.state(page);
      assert.deepEqual(before.selection, [id]);
      await saveFollowupEvidence(h, page, "delete-before", { id, removed });
      await page.keyboard.press("Delete");
      await h.settle(page);
      const after = await h.state(page);
      await saveFollowupEvidence(h, page, "delete-after", { id, removed });
      await assertDeletedClosure(before.xml, after.xml, removed);
      const stale = await page.evaluate(
        (ids) =>
          [...document.querySelectorAll("#viewer [data-element-id]")]
            .filter((e) =>
              ids.some(
                (id) =>
                  e.getAttribute("data-element-id") === id ||
                  e.getAttribute("data-element-id") === id + "_label",
              ),
            )
            .map((e) => e.outerHTML),
        removed,
      );
      assert.deepEqual(stale, [], "deleted graphics, labels and controls disappear");
      for (let i = 0; i < 2; i++) await h.history(page, before, after);
      await h.chooseEdge(page, "ReviewFlow");
      assert.deepEqual((await h.raw(page)).selection, ["ReviewFlow"]);
      return { removed, remaining: Object.keys(after.edges) };
    },
  );

add("F22", "immediate-next-source-and-repeat", "Empty diagram", async (h, page) => {
  const { source: a, target: b } = await h.tasks(page);
  let s = await h.state(page);
  const start = await h.palette(
    page,
    "Start",
    h.screen(s, { x: h.node(s, a).x - 130, y: h.node(s, a).y + 40 }),
  );
  s = await h.state(page);
  const end = await h.palette(
    page,
    "End",
    h.screen(s, { x: h.node(s, b).x + h.node(s, b).width + 100, y: h.node(s, b).y + 40 }),
  );
  const first = await connectNative(h, page, start, a);
  await h.creationOnly(first.before, first.after, first.edge);
  // No Undo/Redo, blank click, selection reset, or leave/re-enter workaround.
  const second = await connectNative(h, page, a, b, {
    side: "right",
    targetSide: "left",
    continuing: true,
  });
  await h.creationOnly(second.before, second.after, second.edge);
  const third = await connectNative(h, page, b, end, {
    side: "right",
    targetSide: "left",
    continuing: true,
  });
  await h.creationOnly(third.before, third.after, third.edge);
  for (const step of [third, second, first]) {
    await h.clickButton(page, "#undo-btn");
    assert.equal((await h.state(page)).xml, step.before.xml);
  }
  for (const step of [first, second, third]) {
    await h.clickButton(page, "#redo-btn");
    assert.equal((await h.state(page)).xml, step.after.xml);
  }
  const reconnect = await redock(h, page, first.edge.id, "source", b, "top");
  await h.reconnectOnly(reconnect.before, reconnect.after, first.edge.id, "source", b);
  await h.history(page, reconnect.before, reconnect.after);
  await h.clickButton(page, "#undo-btn");
  await h.selectNode(page, b);
  const next = await connectNative(h, page, b, a, {
    side: "left",
    targetSide: "top",
    continuing: true,
  });
  await h.creationOnly(next.before, next.after, next.edge);
  await h.history(page, next.before, next.after);
  return {
    nodes: { start, a, b, end },
    first: first.edge,
    second: second.edge,
    third: third.edge,
    repeated: next.edge,
  };
});

for (const mode of ["source", "endpoint"])
  add("F25", `viewport-refresh-${mode}`, "Conditional flows", async (h, page, key) => {
    const initial = await h.state(page),
      a = initial.nodes.find((n) => n.name === "A"),
      b = initial.nodes.find((n) => n.name === "B"),
      t1 = initial.nodes.find((n) => n.name === "T1");
    if (mode === "source") {
      await h.sourcePort(page, b.id, "top");
      const beforeView = await h.state(page);
      await h.zoom(page, 0.5);
      await h.pan(page);
      const changedView = await h.state(page);
      assert.equal(changedView.xml, beforeView.xml);
      assert.deepEqual(changedView.history, beforeView.history);
      // B's left midpoint is already owned by its incoming connection.
      // This workflow tests camera refresh using a visible free point on the same side.
      await continuingPort(h, page, b.id, "left", 0.25);
      return (await h.create(page, b.id, t1.id, "left", "top", { name: key, sourceFraction: 0.25 }))
        .edge;
    }
    const edge = Object.values(initial.edges).find((e) => e.source === a.id && e.target === t1.id);
    await h.chooseEdge(page, edge.id);
    const beforeView = await h.state(page);
    await h.zoom(page, 1.5);
    await h.pan(page);
    const changedView = await h.state(page);
    assert.equal(changedView.xml, beforeView.xml);
    assert.deepEqual(changedView.history, beforeView.history);
    const result = await redock(h, page, edge.id, "target", b.id, "bottom");
    await h.reconnectOnly(result.before, result.after, edge.id, "target", b.id);
    await h.history(page, result.before, result.after);
    return {
      before: result.before.edges[edge.id],
      after: result.after.edges[edge.id],
      release: result.release,
    };
  });
