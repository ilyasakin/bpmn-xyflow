# XML parsing and preservation

The object model and XYFlow engine remain local implementations. XML tokenization
uses exact runtime dependency `saxen@11.2.0` ([source and MIT license](https://github.com/nikku/saxen/tree/v11.2.0)); `bpmn-moddle` remains a development-only oracle.

`lib/bpmn/xml.js` builds an inert plain-object XML tree. It does not use HTML/DOM
parsing, execute scripts, resolve external entities, fetch URLs, or strip content
with sanitizing regular expressions. Declarations and malformed input are
rejected through structural parsing. Native DOM nodes are never produced from
input XML.

The adapter preserves QName namespace meaning across copies and reparenting,
including inherited/default bindings, and decodes XML entities exactly once.
Unknown extension content, Unicode, CDATA text, comments and processing
instructions survive parse/edit/write. Reserved JavaScript names are retained
as inert own data properties.

Verification includes `test/xml-security.mjs` (40 hostile/malformed cases with
DOM/HTML/network APIs poisoned), upstream semantic-oracle comparison across
101 existing fixtures and three business workflows, actual Modeler mutation
exports, and offline official BPMN20 XSD validation. These tests do not replace
hosted CodeQL or real-browser checks; both remain required publication gates.
