/** Explicit fixture setup for tests of authored IO preservation.
 * Creating a visual data association intentionally does not fabricate IO specs.
 * These inputs, outputs and sets are authored before the test's XML baseline.
 */
let sequence = 0;
export function connectAuthoredIO(modeler, source, target, input = true) {
  const owner = (input ? target : source).businessObject, moddle = modeler.getModdle(), suffix = ++sequence;
  let container = owner;
  if (owner.$instanceOf('bpmn:Activity')) {
    container = owner.ioSpecification;
    if (!container) {
      container = moddle.create('bpmn:InputOutputSpecification', { id: `AuthoredIO_${suffix}`, dataInputs: [], dataOutputs: [], inputSets: [], outputSets: [] });
      owner.ioSpecification = container; container.$parent = owner;
      for (const [ key, type ] of [ [ 'inputSets', 'bpmn:InputSet' ], [ 'outputSets', 'bpmn:OutputSet' ] ]) {
        const set = moddle.create(type, { id: `Authored${type.split(':')[1]}_${suffix}` }); set.$parent = container; container[key].push(set);
      }
    }
  }
  const item = moddle.create(input ? 'bpmn:DataInput' : 'bpmn:DataOutput', { id: `Authored${input ? 'Input' : 'Output'}_${suffix}` }); item.$parent = container;
  const key = input ? 'dataInputs' : 'dataOutputs'; container[key] ||= []; container[key].push(item);
  if (container !== owner) {
    const set = container[input ? 'inputSets' : 'outputSets'][0], refs = input ? 'dataInputRefs' : 'dataOutputRefs'; set[refs] ||= []; set[refs].push(item);
  }
  const association = moddle.create(input ? 'bpmn:DataInputAssociation' : 'bpmn:DataOutputAssociation', {
    id: `Authored${input ? 'Input' : 'Output'}Association_${suffix}`,
    sourceRef: [ input ? source.businessObject : item ], targetRef: input ? item : target.businessObject
  });
  const edge = modeler.connect(source, target, { businessObject: association });
  if (!edge) throw new Error('Explicit authored IO fixture connection was rejected');
  return edge;
}
