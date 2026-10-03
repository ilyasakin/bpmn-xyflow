import assert from 'node:assert/strict';
import { BpmnModdle } from 'bpmn-moddle';

const point = value => ({ x: value.x, y: value.y });
const points = edge => edge.waypoints.map(point);
const plus = (value, delta) => ({ x: value.x + delta.x, y: value.y + delta.y });

/** Run solely against the root bundle extracted by consumer-smoke. */
export async function checkFlowAnnotations(api, dom, xml) {
  const modeler = new api.Modeler({ container: dom.createContainer(), fitViewOnInit: false, palette: false });
  const viewer = new api.Viewer({ container: dom.createContainer(), fitViewOnInit: false });
  const oracle = new BpmnModdle();
  const verifyXML = async content => {
    const result = await oracle.fromXML(content);
    assert.deepEqual(result.warnings, [], 'packed flow annotation XML resolves all references');
    return result;
  };
  const exactCommand = async (action, check) => {
    const before = await modeler.getXML(), size = modeler.commandStack.size();
    const result = action();
    assert.ok(result, 'public flow annotation command must succeed');
    await check(result);
    const after = await modeler.getXML();
    assert.notEqual(after, before, 'the intended command must actually change the model');
    assert.equal(modeler.commandStack.size(), size + 1);
    for (let cycle = 0; cycle < 2; cycle++) {
      modeler.undo();
      assert.equal(await modeler.getXML(), before, 'flow annotation undo is byte-exact');
      modeler.redo();
      assert.equal(await modeler.getXML(), after, 'flow annotation redo is byte-exact');
    }
    return result;
  };
  try {
    await modeler.importXML(xml);
    const a = modeler.addShape('bpmn:Task', { x: 250, y: 400 });
    const b = modeler.addShape('bpmn:Task', { x: 600, y: 400 });
    const c = modeler.addShape('bpmn:Task', { x: 950, y: 400 });
    const noteA = modeler.addShape('bpmn:TextAnnotation', { x: 440, y: 160 });
    const noteB = modeler.addShape('bpmn:TextAnnotation', { x: 450, y: 620 });
    assert.ok(a && b && c && noteA && noteB);
    const ownerA = modeler.connect(a, b), ownerB = modeler.connect(b, c);
    assert.ok(ownerA && ownerB);
    modeler.updateLabel(noteA, 'Packed forward annotation');
    modeler.updateLabel(noteB, 'Packed reverse annotation');
    const anchor = point(ownerA.waypoints[0]);
    anchor.x += 60;
    const forward = await exactCommand(() => modeler.connect(ownerA, noteA, { connectionStart: anchor }), edge => {
      assert.equal(edge.type, 'bpmn:Association');
      assert.equal(edge.source, ownerA);
      assert.equal(edge.businessObject.sourceRef, ownerA.businessObject);
      assert.equal(edge.businessObject.targetRef, noteA.businessObject);
    });
    const reverse = await exactCommand(() => modeler.connect(noteB, ownerA, { connectionEnd: anchor }), edge => {
      assert.equal(edge.type, 'bpmn:Association');
      assert.equal(edge.target, ownerA);
      assert.equal(edge.businessObject.sourceRef, noteB.businessObject);
      assert.equal(edge.businessObject.targetRef, ownerA.businessObject);
    });
    // Use the public moddle/property APIs to author a retained metadata record.
    const moddle = modeler.getModdle();
    const record = moddle.createAny('packed:record', 'urn:packed:flow', { code: 'preserve', $body: 'flow annotation metadata' });
    const extension = moddle.create('bpmn:ExtensionElements', { values: [record] });
    record.$parent = extension;
    assert.equal(modeler.updateProperties(forward, { extensionElements: extension }), forward);
    const fixedForwardTarget = point(forward.waypoints.at(-1));
    const fixedReverseSource = point(reverse.waypoints[0]);
    // Same-owner endpoint edits keep the opposite annotation endpoint exact.
    for (const [association, side] of [[forward, 'source'], [reverse, 'target']]) {
      const adjusted = points(association);
      const index = side === 'source' ? 0 : adjusted.length - 1;
      adjusted[index].x += 20;
      await exactCommand(() => modeler.reconnect(association, side, ownerA, adjusted), edge => {
        assert.deepEqual(points(edge), adjusted);
        assert.equal(edge[side], ownerA);
      });
    }
    for (const [association, side] of [[forward, 'source'], [reverse, 'target']]) {
      await exactCommand(() => modeler.reconnect(association, side, ownerB), edge => {
        assert.equal(edge[side], ownerB);
        assert.equal(edge.businessObject[side + 'Ref'], ownerB.businessObject);
        assert.deepEqual(point(forward.waypoints.at(-1)), fixedForwardTarget);
        assert.deepEqual(point(reverse.waypoints[0]), fixedReverseSource);
      });
    }
    const metadata = forward.businessObject.extensionElements.values[0];
    assert.equal(metadata.code, 'preserve');
    assert.equal(metadata.$body, 'flow annotation metadata');
    const beforeForward = points(forward), beforeReverse = points(reverse), delta = { x: 35, y: 25 };
    const translated = points(ownerB).map(p => plus(p, delta));
    await exactCommand(() => modeler.updateWaypoints(ownerB, translated), () => {
      assert.deepEqual(points(ownerB), translated);
      assert.deepEqual(point(forward.waypoints[0]), plus(beforeForward[0], delta));
      assert.deepEqual(point(reverse.waypoints.at(-1)), plus(beforeReverse.at(-1), delta));
      assert.deepEqual(point(forward.waypoints.at(-1)), fixedForwardTarget);
      assert.deepEqual(point(reverse.waypoints[0]), fixedReverseSource);
    });
    const unchanged = await modeler.getXML(), history = modeler.commandStack.size();
    const leadingHole = Array(2), interiorHole = Array(3);
    leadingHole[1] = anchor;
    interiorHole[0] = anchor; interiorHole[2] = { x: 80, y: 100 };
    for (const invalid of [[], [anchor], [anchor, anchor], [null, anchor], [{ x: NaN, y: 20 }, anchor], Array(2), leadingHole, interiorHole]) {
      assert.equal(modeler.connect(ownerB, noteA, { waypoints: invalid }), null);
      assert.equal(modeler.reconnect(forward, 'source', ownerA, invalid), null);
      assert.equal(modeler.updateWaypoints(ownerB, invalid), false);
      assert.equal(await modeler.getXML(), unchanged, 'invalid explicit geometry is an exact no-op');
      assert.equal(modeler.commandStack.size(), history);
    }
    for (const invalid of [null, { x: NaN, y: 10 }, { x: 10, y: Infinity }, { x: '10', y: 10 }]) {
      assert.equal(modeler.connect(ownerB, noteA, { connectionStart: invalid }), null);
      assert.equal(modeler.connect(noteB, ownerB, { connectionEnd: invalid }), null);
      assert.equal(await modeler.getXML(), unchanged, 'malformed docking hints are exact no-ops');
      assert.equal(modeler.commandStack.size(), history);
    }
    assert.equal(modeler.reconnect(forward, 'source', forward), null, 'an association cannot attach to itself');
    assert.equal(await modeler.getXML(), unchanged);
    assert.equal(modeler.commandStack.size(), history);
    const clipboard = modeler.copy([a, b, c, noteA, noteB]);
    assert.ok(clipboard);
    for (const edge of [ownerA, ownerB, forward, reverse]) {
      const copied = clipboard.edges.find(item => item.id === edge.id);
      assert.ok(copied, `clipboard carries connection identity ${edge.id}`);
      assert.equal(copied.sourceId, edge.source.id);
      assert.equal(copied.targetId, edge.target.id);
    }
    const exported = await modeler.getXML(), parsed = await verifyXML(exported);
    for (const edge of [forward, reverse]) {
      assert.equal(parsed.elementsById[edge.id].sourceRef.id, edge.source.id);
      assert.equal(parsed.elementsById[edge.id].targetRef.id, edge.target.id);
    }
    await viewer.importXML(exported);
    for (const edge of [ownerA, ownerB, forward, reverse]) {
      const reopened = viewer.getElement(edge.id);
      assert.equal(reopened.source.id, edge.source.id);
      assert.equal(reopened.target.id, edge.target.id);
      assert.deepEqual(points(reopened), points(edge));
    }
    assert.equal(viewer.getElement(forward.id).businessObject.extensionElements.values[0].code, 'preserve');
    console.log('PASS packed flow annotations: both endpoint directions, redocking, owner changes, dependent routes, metadata, clipboard IDs, invalid-input no-ops, exact history and reopen');
  } finally {
    viewer.destroy();
    modeler.destroy();
  }
}
