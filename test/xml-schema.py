#!/usr/bin/env python3
"""Validate edited/exported BPMN with the official BPMN20 XSD, without networking.

The schema files ship in the pinned dev-only bpmn-moddle 10.3.1 package:
node_modules/bpmn-moddle/resources/bpmn/xsd/BPMN20.xsd
All imports resolve locally to BPMNDI.xsd, Semantic.xsd, DI.xsd and DC.xsd.
Requires Python 3 and lxml (CI pins the tested version); no runtime dependency.
"""
import os
from pathlib import Path
import subprocess
import tempfile

from lxml import etree

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "node_modules/bpmn-moddle/resources/bpmn/xsd/BPMN20.xsd"

# Explicitly disable DTD loading, external entity resolution, and networking.
# Local XSD imports are intentionally allowed and resolved relative to SCHEMA.
parser = etree.XMLParser(no_network=True, resolve_entities=False, load_dtd=False)
schema = etree.XMLSchema(etree.parse(str(SCHEMA), parser))

with tempfile.TemporaryDirectory(prefix="bpmn-xml-schema-") as directory:
    env = {**os.environ, "BPMN_XML_ARTIFACT_DIR": directory}
    subprocess.run(["node", "test/xml-security.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "test/xml-parity.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/modeler.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/connections.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/ui-policy.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/label-resize.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/io-conversion.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/flow-dependencies.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/group-lifecycle.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/global-history.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/group-native-setup.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/hover-delete-order.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/connection-hit-targets.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/data-reconnect-reference.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/flow-append-geometry.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "--test", "test/modeling/flow-redock-snapping.test.mjs"], cwd=ROOT, env=env, check=True)
    subprocess.run(["node", "test/xml-modeler-parity.mjs"], cwd=ROOT, env=env, check=True)
    artifacts = sorted(Path(directory).glob("*.bpmn"))
    if len(artifacts) < 6:
        raise RuntimeError("Missing XML validation artifacts; expected rich edit/clone and business scenarios")
    for artifact in artifacts:
        document = etree.parse(str(artifact), parser)
        if document.docinfo.doctype:
            raise RuntimeError(f"Unexpected DOCTYPE in {artifact.name}")
        schema.assertValid(document)
        print(f"OK official BPMN20.xsd: {artifact.name}", flush=True)
    for fixture in sorted([*(ROOT / "test/fixtures/flow-native").glob("*.bpmn"), *(ROOT / "test/fixtures/group-native").glob("*.bpmn"), *(ROOT / "test/fixtures/hover-native").glob("*.bpmn")]):
        document = etree.parse(str(fixture), parser)
        if document.docinfo.doctype:
            raise RuntimeError(f"Unexpected DOCTYPE in {fixture.name}")
        schema.assertValid(document)
        print(f"OK official BPMN20.xsd native fixture: {fixture.name}", flush=True)
    print(f"Validated {len(artifacts)} generated BPMN exports with lxml {etree.LXML_VERSION}")
