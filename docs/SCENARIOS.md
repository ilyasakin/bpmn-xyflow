# Representative business-process test corpus

These fixtures test modeling fidelity, not execution by a BPMN process engine.
Exported XML is independently parsed by pinned bpmn-moddle 10.3.1; UI/browser
round-trips also require opening it in upstream bpmn-js 18.30.1.

| Scenario | Source / license | Required semantic assertions |
| --- | --- | --- |
| Order, payment, fulfillment, delivery | Original fixture in `test/fixtures/scenarios/order-payment-delivery.bpmn`; project LICENSE; reproducible generator `test/helpers/build-scenarios.mjs` | Customer/seller process separation; purchase/delivery message flows belong to collaboration; payment subprocess completes before invoice/packing parallel split; both branches join before dispatch; IDs and references survive edit and reopen |
| Approval, rejection, rework | Original fixture `test/fixtures/scenarios/approval-rejection-rework.bpmn`; project LICENSE | Requester/reviewer lane membership; explicit approved condition; default rejection path; rework resubmits to review; condition/default/reference survive rename/move/undo-redo/export/reopen |
| Booking timeout and compensation | Original fixture `test/fixtures/scenarios/booking-timeout-compensation.bpmn`; project LICENSE | Expanded transaction contains hotel/flight reservations; interrupting `PT1H` timer reaches cancel end; transaction cancel boundary routes to notification; compensation boundary remains attached to hotel; directed association targets compensation activity; all event definitions and references survive |
| HR recruitment / applicant review | Retained upstream [`complex.bpmn`](https://github.com/bpmn-io/bpmn-js/blob/86aa391d222228e442b11b81584a817a14becb13/test/fixtures/bpmn/complex.bpmn), bpmn-js 18.16.1 original LICENSE | Realistic German-language multi-participant recruitment model: applicant intake, completeness checks, requests for information, interviews, assessment and contract-management interactions. Whole semantic graph and DI equality on round-trip; selected task edits and undo/redo must preserve other process content |

## Evidence requirements

For each scenario:

1. Import fixture and record warnings/errors
2. Assert business-specific references, not merely node counts
3. Rename and move a business task, then undo/redo; preserve semantic ownership
4. Exercise relevant connection/hierarchy operation and undo it
5. Export, parse with upstream moddle, reopen locally and in upstream browser modeler
6. Compare required references/expressions/event definitions/DI after reopening

Node DOM integration can prove editing state, XML and hierarchy invariants. Its
SVG geometry stubs cannot prove visual appearance, pointer hit testing, actual
browser layout, or the upstream browser viewer's rendering. Those remain
explicit browser gates; reports must distinguish them.
