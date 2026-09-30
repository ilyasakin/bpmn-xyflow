/**
 * Inert XML tree adapter around saxen 11.2.0 (MIT).
 * Tokenizer/API provenance: https://github.com/nikku/saxen/tree/v11.2.0
 * No DOM, HTML parsing, entity resolver, URL loading, or executable nodes.
 * saxen deliberately makes attribute/entity processing optional. This adapter
 * applies strict XML 1.0 decoding and namespace rules without normalizing away
 * source QNames, and rejects declarations through the tokenizer's own events.
 */
import { Parser } from 'saxen';

const XML = 'http://www.w3.org/XML/1998/namespace';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const ENTITIES = new Map([ [ 'amp', '&' ], [ 'lt', '<' ], [ 'gt', '>' ], [ 'apos', "'" ], [ 'quot', '"' ] ]);
const SPACE = new Set([ ' ', '\t', '\n', '\r' ]);
// XML 1.0 fifth-edition NameStartChar ranges, excluding namespace separator.
const NAME_START_RANGES = [
  [ 0x41, 0x5A ], [ 0x61, 0x7A ], [ 0xC0, 0xD6 ], [ 0xD8, 0xF6 ],
  [ 0xF8, 0x2FF ], [ 0x370, 0x37D ], [ 0x37F, 0x1FFF ], [ 0x200C, 0x200D ],
  [ 0x2070, 0x218F ], [ 0x2C00, 0x2FEF ], [ 0x3001, 0xD7FF ],
  [ 0xF900, 0xFDCF ], [ 0xFDF0, 0xFFFD ], [ 0x10000, 0xEFFFF ]
];
function nameStart(code) {
  return code === 0x5F || NAME_START_RANGES.some(([ first, last ]) => code >= first && code <= last);
}
function validName(name, allowColon = false) {
  if (!name) return false;
  let first = true;
  for (const character of name) {
    const code = character.codePointAt(0);
    if (!nameStart(code) && !(allowColon && code === 0x3A) && (first || !(code === 0x2D || code === 0x2E || code === 0xB7 || code >= 0x30 && code <= 0x39 || code >= 0x300 && code <= 0x36F || code >= 0x203F && code <= 0x2040))) return false;
    first = false;
  }
  return true;
}

function fail(message) { throw new Error('XML parse error: ' + message); }
function validCharacter(code) {
  return code === 9 || code === 10 || code === 13 || code >= 0x20 && code <= 0xD7FF || code >= 0xE000 && code <= 0xFFFD || code >= 0x10000 && code <= 0x10FFFF;
}
export function isXmlQName(name) {
  const parts = name.split(':');
  return parts.length <= 2 && parts.every(part => validName(part));
}
function qname(name) {
  const parts = name.split(':');
  if (!isXmlQName(name)) fail(`invalid QName <${ name }>`);
  return { prefix: parts.length === 2 ? parts[0] : '', localName: parts[parts.length - 1] };
}

/** Decode exactly XML's five entities and valid Unicode numeric references. */
function decode(value, attribute = false) {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char !== '&') {
      if (attribute && char === '<') fail('literal < in attribute');
      result += attribute && SPACE.has(char) ? ' ' : char;
      continue;
    }
    const end = value.indexOf(';', i + 1);
    if (end === -1) fail('unterminated entity reference');
    const name = value.slice(i + 1, end);
    if (ENTITIES.has(name)) result += ENTITIES.get(name);
    else if (name[0] === '#') {
      const hex = name[1] === 'x';
      const digits = name.slice(hex ? 2 : 1);
      if (!digits || ![ ...digits ].every(digit => (hex ? '0123456789abcdefABCDEF' : '0123456789').includes(digit))) fail('invalid numeric character reference');
      const code = Number.parseInt(digits, hex ? 16 : 10);
      if (!validCharacter(code)) fail('invalid XML character reference');
      result += String.fromCodePoint(code);
    } else fail(`undeclared entity &${ name };`);
    i = end;
  }
  return result;
}

/**
 * Read attributes from an already-tokenized start tag. saxen's optional lazy
 * attribute helper is intentionally not used: it canonicalizes names in NS
 * mode and uses an ordinary object, which cannot retain an __proto__ attribute.
 * The linear reader also accepts XML-legal whitespace around '='.
 */
function attributes(token, name, selfClosing) {
  const result = [];
  const names = new Set();
  const end = token.length - (selfClosing ? 2 : 1);
  let cursor = 1 + name.length;
  while (cursor < end) {
    if (!SPACE.has(token[cursor])) fail('missing whitespace before attribute');
    while (SPACE.has(token[cursor])) cursor++;
    if (cursor === end) break;
    const start = cursor;
    while (cursor < end && !SPACE.has(token[cursor]) && token[cursor] !== '=') cursor++;
    const name = token.slice(start, cursor);
    const parsed = qname(name);
    while (SPACE.has(token[cursor])) cursor++;
    if (token[cursor++] !== '=') fail('missing attribute value');
    while (SPACE.has(token[cursor])) cursor++;
    const quote = token[cursor++];
    if (quote !== '"' && quote !== "'") fail('missing attribute quotes');
    const close = token.indexOf(quote, cursor);
    if (close === -1 || close > end) fail('unclosed attribute value');
    if (names.has(name)) fail(`duplicate attribute <${ name }>`);
    names.add(name);
    result.push({ name, ...parsed, value: decode(token.slice(cursor, close), true) });
    cursor = close + 1;
  }
  return result;
}

export function parseXmlTree(source) {
  if (typeof source !== 'string') fail('expected an XML string');
  let xml = '';
  // XML 1.0 end-of-line normalization and character validation. This is not a
  // markup filter: declarations, comments and CDATA reach the SAX tokenizer.
  for (let i = source.charCodeAt(0) === 0xFEFF ? 1 : 0; i < source.length; i++) {
    const code = source.codePointAt(i);
    if (!validCharacter(code)) fail('invalid XML character');
    if (code === 13) {
      xml += '\n';
      if (source.charCodeAt(i + 1) === 10) i++;
    } else {
      xml += String.fromCodePoint(code);
      if (code > 0xFFFF) i++;
    }
  }
  const parser = new Parser();
  const stack = [];
  const document = { documentElement: null, before: [], after: [] };
  let declarationSeen = false;

  function append(node) {
    if (stack.length) stack[stack.length - 1].childNodes.push(node);
    else if (node.nodeType === 7 || node.nodeType === 8) (document.documentElement ? document.after : document.before).push(node.raw);
    else fail('content outside root element');
  }

  parser.on('error', error => { throw error; });
  parser.on('warn', warning => { throw warning; });
  parser.on('attention', () => fail('DOCTYPE and entity declarations are not supported'));
  parser.on('openTag', (name, _getAttributes, _decode, selfClosing, context) => {
    const parsedName = qname(name);
    const attrs = attributes(context().data, name, selfClosing);
    const parentScope = stack.length ? stack[stack.length - 1].scope : { xml: XML, '': '' };
    const scope = Object.assign(Object.create(null), parentScope);
    for (const attr of attrs) {
      if (attr.name !== 'xmlns' && attr.prefix !== 'xmlns') continue;
      const prefix = attr.name === 'xmlns' ? '' : attr.localName;
      if (prefix === 'xmlns' || attr.value === XMLNS || prefix === 'xml' && attr.value !== XML || prefix !== 'xml' && attr.value === XML || prefix && !attr.value) fail('invalid namespace declaration');
      scope[prefix] = attr.value;
    }
    if (parsedName.prefix === 'xmlns') fail('reserved xmlns element prefix');
    if (parsedName.prefix && !scope[parsedName.prefix]) fail(`unbound prefix <${ parsedName.prefix }>`);
    const expandedAttributes = new Set();
    for (const attr of attrs) {
      attr.namespaceURI = attr.name === 'xmlns' || attr.prefix === 'xmlns' ? XMLNS : attr.prefix ? scope[attr.prefix] : null;
      if (attr.prefix && !attr.namespaceURI) fail(`unbound prefix <${ attr.prefix }>`);
      const expanded = (attr.namespaceURI || '') + '#' + attr.localName;
      if (expandedAttributes.has(expanded)) fail(`duplicate expanded attribute <${ attr.name }>`);
      expandedAttributes.add(expanded);
    }
    const element = {
      nodeType: 1, nodeName: name, localName: parsedName.localName,
      namespaceURI: scope[parsedName.prefix] || null,
      attributes: attrs, childNodes: [], scope,
      getAttributeNS(uri, localName) { return attrs.find(attr => attr.namespaceURI === uri && attr.localName === localName)?.value ?? null; },
      hasAttributeNS(uri, localName) { return attrs.some(attr => attr.namespaceURI === uri && attr.localName === localName); },
      lookupNamespaceURI(prefix) { return scope[prefix || ''] || null; },
      get textContent() { return this.childNodes.map(child => child.nodeType === 1 ? child.textContent : child.nodeType === 3 || child.nodeType === 4 ? child.nodeValue : '').join(''); }
    };
    if (!stack.length) {
      if (document.documentElement) fail('multiple root elements');
      document.documentElement = element;
    } else append(element);
    stack.push(element);
  });
  parser.on('closeTag', name => {
    if (stack.pop()?.nodeName !== name) fail('mismatched closing tag');
  });
  parser.on('text', value => {
    if (value.includes(']]>')) fail('CDATA terminator outside CDATA');
    append({ nodeType: 3, nodeValue: decode(value) });
  });
  parser.on('cdata', value => append({ nodeType: 4, nodeValue: value }));
  parser.on('comment', value => {
    if (value.includes('--') || value.endsWith('-')) fail('invalid XML comment');
    append({ nodeType: 8, raw: '<!--' + value + '-->' });
  });
  parser.on('question', raw => {
    const inner = raw.slice(2, -2);
    let end = 0;
    while (end < inner.length && !SPACE.has(inner[end])) end++;
    const target = inner.slice(0, end);
    if (!validName(target, true)) fail('invalid processing instruction target');
    if (target.toLowerCase() === 'xml') {
      // Grammar validation only: the declaration is never passed to a DOM or
      // modified and reparsed. XML 1.0 is the version supported by this adapter.
      if (target !== 'xml' || declarationSeen || !xml.startsWith(raw) || !/^<\?xml[ \t\n]+version[ \t\n]*=[ \t\n]*(['"])1\.0\1(?:[ \t\n]+encoding[ \t\n]*=[ \t\n]*(['"])[A-Za-z][A-Za-z0-9._-]*\2)?(?:[ \t\n]+standalone[ \t\n]*=[ \t\n]*(['"])(?:yes|no)\3)?[ \t\n]*\?>$/.test(raw)) fail('invalid XML declaration');
      declarationSeen = true;
      return;
    }
    append({ nodeType: 7, raw });
  });
  const error = parser.parse(xml);
  if (error) throw error;
  if (!document.documentElement || stack.length) fail('missing or unclosed root element');
  return document;
}
