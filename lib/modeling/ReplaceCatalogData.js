/**
 * Generated from bpmn-js 18.30.1 ReplaceOptions.js and PopupEntries.js.
 * Copyright (c) 2014-present Camunda Services GmbH. See ../../LICENSE.
 * https://github.com/bpmn-io/bpmn-js/tree/v18.30.1/lib/features
 * Source SHA256: ReplaceOptions 13da2d5878b2f9faeac22b694a9b34a729e8d8d803d7d3d15bb9e6c8689f9fe9
 * Source SHA256: PopupEntries d35ae1b89f2bcc2fccebfa42341604e07e99e2e27ce69860f662ea593921e73b
 * Static data only: no bpmn-js runtime dependency. Update with the oracle tests.
 */
export const REPLACE_OPTIONS = {
  "AD_HOC_SUBPROCESS_EXPANDED": [
    {
      "label": "Sub-process",
      "className": "bpmn-icon-subprocess-expanded",
      "target": {
        "type": "bpmn:SubProcess",
        "isExpanded": true
      },
      "actionName": "replace-with-subprocess"
    },
    {
      "label": "Transaction",
      "className": "bpmn-icon-transaction",
      "target": {
        "type": "bpmn:Transaction",
        "isExpanded": true
      },
      "actionName": "replace-with-transaction"
    },
    {
      "label": "Event sub-process",
      "className": "bpmn-icon-event-subprocess-expanded",
      "target": {
        "type": "bpmn:SubProcess",
        "triggeredByEvent": true,
        "isExpanded": true
      },
      "actionName": "replace-with-event-subprocess"
    },
    {
      "label": "Ad-hoc sub-process (collapsed)",
      "className": "bpmn-icon-subprocess-collapsed",
      "target": {
        "type": "bpmn:AdHocSubProcess",
        "isExpanded": false
      },
      "actionName": "replace-with-collapsed-ad-hoc-subprocess"
    }
  ],
  "BOUNDARY_EVENT": [
    {
      "label": "Message boundary event",
      "className": "bpmn-icon-intermediate-event-catch-message",
      "target": {
        "type": "bpmn:BoundaryEvent",
        "eventDefinitionType": "bpmn:MessageEventDefinition",
        "cancelActivity": true
      },
      "actionName": "replace-with-message-boundary"
    },
    {
      "label": "Timer boundary event",
      "className": "bpmn-icon-intermediate-event-catch-timer",
      "target": {
        "type": "bpmn:BoundaryEvent",
        "eventDefinitionType": "bpmn:TimerEventDefinition",
        "cancelActivity": true
      },
      "actionName": "replace-with-timer-boundary"
    },
    {
      "label": "Escalation boundary event",
      "className": "bpmn-icon-intermediate-event-catch-escalation",
      "target": {
        "type": "bpmn:BoundaryEvent",
        "eventDefinitionType": "bpmn:EscalationEventDefinition",
        "cancelActivity": true
      },
      "actionName": "replace-with-escalation-boundary"
    },
    {
      "label": "Conditional boundary event",
      "className": "bpmn-icon-intermediate-event-catch-condition",
      "target": {
        "type": "bpmn:BoundaryEvent",
        "eventDefinitionType": "bpmn:ConditionalEventDefinition",
        "cancelActivity": true
      },
      "actionName": "replace-with-conditional-boundary"
    },
    {
      "label": "Error boundary event",
      "className": "bpmn-icon-intermediate-event-catch-error",
      "target": {
        "type": "bpmn:BoundaryEvent",
        "eventDefinitionType": "bpmn:ErrorEventDefinition",
        "cancelActivity": true
      },
      "actionName": "replace-with-error-boundary"
    },
    {
      "label": "Cancel boundary event",
      "className": "bpmn-icon-intermediate-event-catch-cancel",
      "target": {
        "type": "bpmn:BoundaryEvent",
        "eventDefinitionType": "bpmn:CancelEventDefinition",
        "cancelActivity": true
      },
      "actionName": "replace-with-cancel-boundary"
    },
    {
      "label": "Signal boundary event",
      "className": "bpmn-icon-intermediate-event-catch-signal",
      "target": {
        "type": "bpmn:BoundaryEvent",
        "eventDefinitionType": "bpmn:SignalEventDefinition",
        "cancelActivity": true
      },
      "actionName": "replace-with-signal-boundary"
    },
    {
      "label": "Compensation boundary event",
      "className": "bpmn-icon-intermediate-event-catch-compensation",
      "target": {
        "type": "bpmn:BoundaryEvent",
        "eventDefinitionType": "bpmn:CompensateEventDefinition",
        "cancelActivity": true
      },
      "actionName": "replace-with-compensation-boundary"
    },
    {
      "label": "Message boundary event (non-interrupting)",
      "className": "bpmn-icon-intermediate-event-catch-non-interrupting-message",
      "target": {
        "type": "bpmn:BoundaryEvent",
        "eventDefinitionType": "bpmn:MessageEventDefinition",
        "cancelActivity": false
      },
      "actionName": "replace-with-non-interrupting-message-boundary"
    },
    {
      "label": "Timer boundary event (non-interrupting)",
      "className": "bpmn-icon-intermediate-event-catch-non-interrupting-timer",
      "target": {
        "type": "bpmn:BoundaryEvent",
        "eventDefinitionType": "bpmn:TimerEventDefinition",
        "cancelActivity": false
      },
      "actionName": "replace-with-non-interrupting-timer-boundary"
    },
    {
      "label": "Escalation boundary event (non-interrupting)",
      "className": "bpmn-icon-intermediate-event-catch-non-interrupting-escalation",
      "target": {
        "type": "bpmn:BoundaryEvent",
        "eventDefinitionType": "bpmn:EscalationEventDefinition",
        "cancelActivity": false
      },
      "actionName": "replace-with-non-interrupting-escalation-boundary"
    },
    {
      "label": "Conditional boundary event (non-interrupting)",
      "className": "bpmn-icon-intermediate-event-catch-non-interrupting-condition",
      "target": {
        "type": "bpmn:BoundaryEvent",
        "eventDefinitionType": "bpmn:ConditionalEventDefinition",
        "cancelActivity": false
      },
      "actionName": "replace-with-non-interrupting-conditional-boundary"
    },
    {
      "label": "Signal boundary event (non-interrupting)",
      "className": "bpmn-icon-intermediate-event-catch-non-interrupting-signal",
      "target": {
        "type": "bpmn:BoundaryEvent",
        "eventDefinitionType": "bpmn:SignalEventDefinition",
        "cancelActivity": false
      },
      "actionName": "replace-with-non-interrupting-signal-boundary"
    }
  ],
  "DATA_OBJECT_REFERENCE": [
    {
      "label": "Data store reference",
      "className": "bpmn-icon-data-store",
      "target": {
        "type": "bpmn:DataStoreReference"
      },
      "actionName": "replace-with-data-store-reference"
    }
  ],
  "DATA_STORE_REFERENCE": [
    {
      "label": "Data object reference",
      "className": "bpmn-icon-data-object",
      "target": {
        "type": "bpmn:DataObjectReference"
      },
      "actionName": "replace-with-data-object-reference"
    }
  ],
  "END_EVENT": [
    {
      "label": "Start event",
      "className": "bpmn-icon-start-event-none",
      "target": {
        "type": "bpmn:StartEvent"
      },
      "actionName": "replace-with-none-start"
    },
    {
      "label": "Intermediate throw event",
      "className": "bpmn-icon-intermediate-event-none",
      "target": {
        "type": "bpmn:IntermediateThrowEvent"
      },
      "actionName": "replace-with-none-intermediate-throw"
    },
    {
      "label": "End event",
      "className": "bpmn-icon-end-event-none",
      "target": {
        "type": "bpmn:EndEvent"
      },
      "actionName": "replace-with-none-end"
    },
    {
      "label": "Message end event",
      "className": "bpmn-icon-end-event-message",
      "target": {
        "type": "bpmn:EndEvent",
        "eventDefinitionType": "bpmn:MessageEventDefinition"
      },
      "actionName": "replace-with-message-end"
    },
    {
      "label": "Escalation end event",
      "className": "bpmn-icon-end-event-escalation",
      "target": {
        "type": "bpmn:EndEvent",
        "eventDefinitionType": "bpmn:EscalationEventDefinition"
      },
      "actionName": "replace-with-escalation-end"
    },
    {
      "label": "Error end event",
      "className": "bpmn-icon-end-event-error",
      "target": {
        "type": "bpmn:EndEvent",
        "eventDefinitionType": "bpmn:ErrorEventDefinition"
      },
      "actionName": "replace-with-error-end"
    },
    {
      "label": "Cancel end event",
      "className": "bpmn-icon-end-event-cancel",
      "target": {
        "type": "bpmn:EndEvent",
        "eventDefinitionType": "bpmn:CancelEventDefinition"
      },
      "actionName": "replace-with-cancel-end"
    },
    {
      "label": "Compensation end event",
      "className": "bpmn-icon-end-event-compensation",
      "target": {
        "type": "bpmn:EndEvent",
        "eventDefinitionType": "bpmn:CompensateEventDefinition"
      },
      "actionName": "replace-with-compensation-end"
    },
    {
      "label": "Signal end event",
      "className": "bpmn-icon-end-event-signal",
      "target": {
        "type": "bpmn:EndEvent",
        "eventDefinitionType": "bpmn:SignalEventDefinition"
      },
      "actionName": "replace-with-signal-end"
    },
    {
      "label": "Terminate end event",
      "className": "bpmn-icon-end-event-terminate",
      "target": {
        "type": "bpmn:EndEvent",
        "eventDefinitionType": "bpmn:TerminateEventDefinition"
      },
      "actionName": "replace-with-terminate-end"
    }
  ],
  "EVENT_SUB_PROCESS": [
    {
      "label": "Transaction",
      "className": "bpmn-icon-transaction",
      "target": {
        "type": "bpmn:Transaction",
        "isExpanded": true
      },
      "actionName": "replace-with-transaction"
    },
    {
      "label": "Sub-process",
      "className": "bpmn-icon-subprocess-expanded",
      "target": {
        "type": "bpmn:SubProcess",
        "isExpanded": true
      },
      "actionName": "replace-with-subprocess"
    },
    {
      "label": "Ad-hoc sub-process",
      "className": "bpmn-icon-subprocess-expanded",
      "target": {
        "type": "bpmn:AdHocSubProcess",
        "isExpanded": true
      },
      "actionName": "replace-with-ad-hoc-subprocess"
    },
    {
      "label": "Event sub-process",
      "className": "bpmn-icon-event-subprocess-expanded",
      "target": {
        "type": "bpmn:SubProcess",
        "triggeredByEvent": true,
        "isExpanded": true
      },
      "actionName": "replace-with-event-subprocess"
    }
  ],
  "EVENT_SUB_PROCESS_START_EVENT": [
    {
      "label": "Message start event",
      "className": "bpmn-icon-start-event-message",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:MessageEventDefinition",
        "isInterrupting": true
      },
      "actionName": "replace-with-message-start"
    },
    {
      "label": "Timer start event",
      "className": "bpmn-icon-start-event-timer",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:TimerEventDefinition",
        "isInterrupting": true
      },
      "actionName": "replace-with-timer-start"
    },
    {
      "label": "Conditional start event",
      "className": "bpmn-icon-start-event-condition",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:ConditionalEventDefinition",
        "isInterrupting": true
      },
      "actionName": "replace-with-conditional-start"
    },
    {
      "label": "Signal start event",
      "className": "bpmn-icon-start-event-signal",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:SignalEventDefinition",
        "isInterrupting": true
      },
      "actionName": "replace-with-signal-start"
    },
    {
      "label": "Error start event",
      "className": "bpmn-icon-start-event-error",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:ErrorEventDefinition",
        "isInterrupting": true
      },
      "actionName": "replace-with-error-start"
    },
    {
      "label": "Escalation start event",
      "className": "bpmn-icon-start-event-escalation",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:EscalationEventDefinition",
        "isInterrupting": true
      },
      "actionName": "replace-with-escalation-start"
    },
    {
      "label": "Compensation start event",
      "className": "bpmn-icon-start-event-compensation",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:CompensateEventDefinition",
        "isInterrupting": true
      },
      "actionName": "replace-with-compensation-start"
    },
    {
      "label": "Message start event (non-interrupting)",
      "className": "bpmn-icon-start-event-non-interrupting-message",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:MessageEventDefinition",
        "isInterrupting": false
      },
      "actionName": "replace-with-non-interrupting-message-start"
    },
    {
      "label": "Timer start event (non-interrupting)",
      "className": "bpmn-icon-start-event-non-interrupting-timer",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:TimerEventDefinition",
        "isInterrupting": false
      },
      "actionName": "replace-with-non-interrupting-timer-start"
    },
    {
      "label": "Conditional start event (non-interrupting)",
      "className": "bpmn-icon-start-event-non-interrupting-condition",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:ConditionalEventDefinition",
        "isInterrupting": false
      },
      "actionName": "replace-with-non-interrupting-conditional-start"
    },
    {
      "label": "Signal start event (non-interrupting)",
      "className": "bpmn-icon-start-event-non-interrupting-signal",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:SignalEventDefinition",
        "isInterrupting": false
      },
      "actionName": "replace-with-non-interrupting-signal-start"
    },
    {
      "label": "Escalation start event (non-interrupting)",
      "className": "bpmn-icon-start-event-non-interrupting-escalation",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:EscalationEventDefinition",
        "isInterrupting": false
      },
      "actionName": "replace-with-non-interrupting-escalation-start"
    }
  ],
  "GATEWAY": [
    {
      "label": "Exclusive gateway",
      "className": "bpmn-icon-gateway-xor",
      "target": {
        "type": "bpmn:ExclusiveGateway"
      },
      "actionName": "replace-with-exclusive-gateway"
    },
    {
      "label": "Parallel gateway",
      "className": "bpmn-icon-gateway-parallel",
      "target": {
        "type": "bpmn:ParallelGateway"
      },
      "actionName": "replace-with-parallel-gateway"
    },
    {
      "label": "Inclusive gateway",
      "className": "bpmn-icon-gateway-or",
      "target": {
        "type": "bpmn:InclusiveGateway"
      },
      "actionName": "replace-with-inclusive-gateway"
    },
    {
      "label": "Complex gateway",
      "className": "bpmn-icon-gateway-complex",
      "target": {
        "type": "bpmn:ComplexGateway"
      },
      "actionName": "replace-with-complex-gateway"
    },
    {
      "label": "Event-based gateway",
      "className": "bpmn-icon-gateway-eventbased",
      "target": {
        "type": "bpmn:EventBasedGateway",
        "instantiate": false,
        "eventGatewayType": "Exclusive"
      },
      "actionName": "replace-with-event-based-gateway"
    }
  ],
  "INTERMEDIATE_EVENT": [
    {
      "label": "Start event",
      "className": "bpmn-icon-start-event-none",
      "target": {
        "type": "bpmn:StartEvent"
      },
      "actionName": "replace-with-none-start"
    },
    {
      "label": "Intermediate throw event",
      "className": "bpmn-icon-intermediate-event-none",
      "target": {
        "type": "bpmn:IntermediateThrowEvent"
      },
      "actionName": "replace-with-none-intermediate-throw"
    },
    {
      "label": "End event",
      "className": "bpmn-icon-end-event-none",
      "target": {
        "type": "bpmn:EndEvent"
      },
      "actionName": "replace-with-none-end"
    },
    {
      "label": "Message intermediate catch event",
      "className": "bpmn-icon-intermediate-event-catch-message",
      "target": {
        "type": "bpmn:IntermediateCatchEvent",
        "eventDefinitionType": "bpmn:MessageEventDefinition"
      },
      "actionName": "replace-with-message-intermediate-catch"
    },
    {
      "label": "Message intermediate throw event",
      "className": "bpmn-icon-intermediate-event-throw-message",
      "target": {
        "type": "bpmn:IntermediateThrowEvent",
        "eventDefinitionType": "bpmn:MessageEventDefinition"
      },
      "actionName": "replace-with-message-intermediate-throw"
    },
    {
      "label": "Timer intermediate catch event",
      "className": "bpmn-icon-intermediate-event-catch-timer",
      "target": {
        "type": "bpmn:IntermediateCatchEvent",
        "eventDefinitionType": "bpmn:TimerEventDefinition"
      },
      "actionName": "replace-with-timer-intermediate-catch"
    },
    {
      "label": "Escalation intermediate throw event",
      "className": "bpmn-icon-intermediate-event-throw-escalation",
      "target": {
        "type": "bpmn:IntermediateThrowEvent",
        "eventDefinitionType": "bpmn:EscalationEventDefinition"
      },
      "actionName": "replace-with-escalation-intermediate-throw"
    },
    {
      "label": "Conditional intermediate catch event",
      "className": "bpmn-icon-intermediate-event-catch-condition",
      "target": {
        "type": "bpmn:IntermediateCatchEvent",
        "eventDefinitionType": "bpmn:ConditionalEventDefinition"
      },
      "actionName": "replace-with-conditional-intermediate-catch"
    },
    {
      "label": "Link intermediate catch event",
      "className": "bpmn-icon-intermediate-event-catch-link",
      "target": {
        "type": "bpmn:IntermediateCatchEvent",
        "eventDefinitionType": "bpmn:LinkEventDefinition",
        "eventDefinitionAttrs": {
          "name": ""
        }
      },
      "actionName": "replace-with-link-intermediate-catch"
    },
    {
      "label": "Link intermediate throw event",
      "className": "bpmn-icon-intermediate-event-throw-link",
      "target": {
        "type": "bpmn:IntermediateThrowEvent",
        "eventDefinitionType": "bpmn:LinkEventDefinition",
        "eventDefinitionAttrs": {
          "name": ""
        }
      },
      "actionName": "replace-with-link-intermediate-throw"
    },
    {
      "label": "Compensation intermediate throw event",
      "className": "bpmn-icon-intermediate-event-throw-compensation",
      "target": {
        "type": "bpmn:IntermediateThrowEvent",
        "eventDefinitionType": "bpmn:CompensateEventDefinition"
      },
      "actionName": "replace-with-compensation-intermediate-throw"
    },
    {
      "label": "Signal intermediate catch event",
      "className": "bpmn-icon-intermediate-event-catch-signal",
      "target": {
        "type": "bpmn:IntermediateCatchEvent",
        "eventDefinitionType": "bpmn:SignalEventDefinition"
      },
      "actionName": "replace-with-signal-intermediate-catch"
    },
    {
      "label": "Signal intermediate throw event",
      "className": "bpmn-icon-intermediate-event-throw-signal",
      "target": {
        "type": "bpmn:IntermediateThrowEvent",
        "eventDefinitionType": "bpmn:SignalEventDefinition"
      },
      "actionName": "replace-with-signal-intermediate-throw"
    }
  ],
  "PARTICIPANT": [
    {
      "label": "Expanded pool/participant",
      "className": "bpmn-icon-participant",
      "target": {
        "type": "bpmn:Participant",
        "isExpanded": true
      },
      "actionName": "replace-with-expanded-pool"
    },
    {
      "label": function(element) {
      var label = 'Empty pool/participant';

      if (element.children && element.children.length) {
        label += ' (removes content)';
      }

      return label;
    },
      "className": "bpmn-icon-lane",
      "target": {
        "type": "bpmn:Participant",
        "isExpanded": false
      },
      "actionName": "replace-with-collapsed-pool"
    }
  ],
  "SEQUENCE_FLOW": [
    {
      "label": "Sequence flow",
      "actionName": "replace-with-sequence-flow",
      "className": "bpmn-icon-connection"
    },
    {
      "label": "Default flow",
      "actionName": "replace-with-default-flow",
      "className": "bpmn-icon-default-flow"
    },
    {
      "label": "Conditional flow",
      "actionName": "replace-with-conditional-flow",
      "className": "bpmn-icon-conditional-flow"
    }
  ],
  "START_EVENT": [
    {
      "label": "Start event",
      "className": "bpmn-icon-start-event-none",
      "target": {
        "type": "bpmn:StartEvent"
      },
      "actionName": "replace-with-none-start"
    },
    {
      "label": "Intermediate throw event",
      "className": "bpmn-icon-intermediate-event-none",
      "target": {
        "type": "bpmn:IntermediateThrowEvent"
      },
      "actionName": "replace-with-none-intermediate-throwing"
    },
    {
      "label": "End event",
      "className": "bpmn-icon-end-event-none",
      "target": {
        "type": "bpmn:EndEvent"
      },
      "actionName": "replace-with-none-end"
    },
    {
      "label": "Message start event",
      "className": "bpmn-icon-start-event-message",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:MessageEventDefinition",
        "isInterrupting": true
      },
      "actionName": "replace-with-message-start"
    },
    {
      "label": "Timer start event",
      "className": "bpmn-icon-start-event-timer",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:TimerEventDefinition",
        "isInterrupting": true
      },
      "actionName": "replace-with-timer-start"
    },
    {
      "label": "Conditional start event",
      "className": "bpmn-icon-start-event-condition",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:ConditionalEventDefinition",
        "isInterrupting": true
      },
      "actionName": "replace-with-conditional-start"
    },
    {
      "label": "Signal start event",
      "className": "bpmn-icon-start-event-signal",
      "target": {
        "type": "bpmn:StartEvent",
        "eventDefinitionType": "bpmn:SignalEventDefinition",
        "isInterrupting": true
      },
      "actionName": "replace-with-signal-start"
    }
  ],
  "START_EVENT_SUB_PROCESS": [
    {
      "label": "Start event",
      "className": "bpmn-icon-start-event-none",
      "target": {
        "type": "bpmn:StartEvent"
      },
      "actionName": "replace-with-none-start"
    },
    {
      "label": "Intermediate throw event",
      "className": "bpmn-icon-intermediate-event-none",
      "target": {
        "type": "bpmn:IntermediateThrowEvent"
      },
      "actionName": "replace-with-none-intermediate-throwing"
    },
    {
      "label": "End event",
      "className": "bpmn-icon-end-event-none",
      "target": {
        "type": "bpmn:EndEvent"
      },
      "actionName": "replace-with-none-end"
    }
  ],
  "SUBPROCESS_EXPANDED": [
    {
      "label": "Transaction",
      "className": "bpmn-icon-transaction",
      "target": {
        "type": "bpmn:Transaction",
        "isExpanded": true
      },
      "actionName": "replace-with-transaction"
    },
    {
      "label": "Event sub-process",
      "className": "bpmn-icon-event-subprocess-expanded",
      "target": {
        "type": "bpmn:SubProcess",
        "triggeredByEvent": true,
        "isExpanded": true
      },
      "actionName": "replace-with-event-subprocess"
    },
    {
      "label": "Ad-hoc sub-process",
      "className": "bpmn-icon-subprocess-expanded",
      "target": {
        "type": "bpmn:AdHocSubProcess",
        "isExpanded": true
      },
      "actionName": "replace-with-ad-hoc-subprocess"
    },
    {
      "label": "Sub-process (collapsed)",
      "className": "bpmn-icon-subprocess-collapsed",
      "target": {
        "type": "bpmn:SubProcess",
        "isExpanded": false
      },
      "actionName": "replace-with-collapsed-subprocess"
    }
  ],
  "TASK": [
    {
      "label": "Task",
      "className": "bpmn-icon-task",
      "target": {
        "type": "bpmn:Task"
      },
      "actionName": "replace-with-task"
    },
    {
      "label": "User task",
      "className": "bpmn-icon-user",
      "target": {
        "type": "bpmn:UserTask"
      },
      "actionName": "replace-with-user-task"
    },
    {
      "label": "Service task",
      "className": "bpmn-icon-service",
      "target": {
        "type": "bpmn:ServiceTask"
      },
      "actionName": "replace-with-service-task"
    },
    {
      "label": "Send task",
      "className": "bpmn-icon-send",
      "target": {
        "type": "bpmn:SendTask"
      },
      "actionName": "replace-with-send-task"
    },
    {
      "label": "Receive task",
      "className": "bpmn-icon-receive",
      "target": {
        "type": "bpmn:ReceiveTask"
      },
      "actionName": "replace-with-receive-task"
    },
    {
      "label": "Manual task",
      "className": "bpmn-icon-manual",
      "target": {
        "type": "bpmn:ManualTask"
      },
      "actionName": "replace-with-manual-task"
    },
    {
      "label": "Business rule task",
      "className": "bpmn-icon-business-rule",
      "target": {
        "type": "bpmn:BusinessRuleTask"
      },
      "actionName": "replace-with-rule-task"
    },
    {
      "label": "Script task",
      "className": "bpmn-icon-script",
      "target": {
        "type": "bpmn:ScriptTask"
      },
      "actionName": "replace-with-script-task"
    },
    {
      "label": "Call activity",
      "className": "bpmn-icon-call-activity",
      "target": {
        "type": "bpmn:CallActivity"
      },
      "actionName": "replace-with-call-activity"
    },
    {
      "label": "Sub-process (collapsed)",
      "className": "bpmn-icon-subprocess-collapsed",
      "target": {
        "type": "bpmn:SubProcess",
        "isExpanded": false
      },
      "actionName": "replace-with-collapsed-subprocess"
    },
    {
      "label": "Sub-process (expanded)",
      "className": "bpmn-icon-subprocess-expanded",
      "target": {
        "type": "bpmn:SubProcess",
        "isExpanded": true
      },
      "actionName": "replace-with-expanded-subprocess"
    },
    {
      "label": "Ad-hoc sub-process (collapsed)",
      "className": "bpmn-icon-subprocess-collapsed",
      "target": {
        "type": "bpmn:AdHocSubProcess",
        "isExpanded": false
      },
      "actionName": "replace-with-collapsed-ad-hoc-subprocess"
    },
    {
      "label": "Ad-hoc sub-process (expanded)",
      "className": "bpmn-icon-subprocess-expanded",
      "target": {
        "type": "bpmn:AdHocSubProcess",
        "isExpanded": true
      },
      "actionName": "replace-with-ad-hoc-subprocess"
    }
  ],
  "TRANSACTION": [
    {
      "label": "Transaction",
      "className": "bpmn-icon-transaction",
      "target": {
        "type": "bpmn:Transaction",
        "isExpanded": true
      },
      "actionName": "replace-with-transaction"
    },
    {
      "label": "Sub-process",
      "className": "bpmn-icon-subprocess-expanded",
      "target": {
        "type": "bpmn:SubProcess",
        "isExpanded": true
      },
      "actionName": "replace-with-subprocess"
    },
    {
      "label": "Ad-hoc sub-process",
      "className": "bpmn-icon-subprocess-expanded",
      "target": {
        "type": "bpmn:AdHocSubProcess",
        "isExpanded": true
      },
      "actionName": "replace-with-ad-hoc-subprocess"
    },
    {
      "label": "Event sub-process",
      "className": "bpmn-icon-event-subprocess-expanded",
      "target": {
        "type": "bpmn:SubProcess",
        "triggeredByEvent": true,
        "isExpanded": true
      },
      "actionName": "replace-with-event-subprocess"
    }
  ],
  "TYPED_EVENT": {
    "bpmn:MessageEventDefinition": [
      {
        "label": "Message start event",
        "className": "bpmn-icon-start-event-message",
        "target": {
          "type": "bpmn:StartEvent",
          "eventDefinitionType": "bpmn:MessageEventDefinition",
          "isInterrupting": true
        },
        "actionName": "replace-with-message-start"
      },
      {
        "label": "Message intermediate catch event",
        "className": "bpmn-icon-intermediate-event-catch-message",
        "target": {
          "type": "bpmn:IntermediateCatchEvent",
          "eventDefinitionType": "bpmn:MessageEventDefinition"
        },
        "actionName": "replace-with-message-intermediate-catch"
      },
      {
        "label": "Message intermediate throw event",
        "className": "bpmn-icon-intermediate-event-throw-message",
        "target": {
          "type": "bpmn:IntermediateThrowEvent",
          "eventDefinitionType": "bpmn:MessageEventDefinition"
        },
        "actionName": "replace-with-message-intermediate-throw"
      },
      {
        "label": "Message end event",
        "className": "bpmn-icon-end-event-message",
        "target": {
          "type": "bpmn:EndEvent",
          "eventDefinitionType": "bpmn:MessageEventDefinition"
        },
        "actionName": "replace-with-message-end"
      }
    ],
    "bpmn:TimerEventDefinition": [
      {
        "label": "Timer start event",
        "className": "bpmn-icon-start-event-timer",
        "target": {
          "type": "bpmn:StartEvent",
          "eventDefinitionType": "bpmn:TimerEventDefinition",
          "isInterrupting": true
        },
        "actionName": "replace-with-timer-start"
      },
      {
        "label": "Timer intermediate catch event",
        "className": "bpmn-icon-intermediate-event-catch-timer",
        "target": {
          "type": "bpmn:IntermediateCatchEvent",
          "eventDefinitionType": "bpmn:TimerEventDefinition"
        },
        "actionName": "replace-with-timer-intermediate-catch"
      }
    ],
    "bpmn:ConditionalEventDefinition": [
      {
        "label": "Conditional start event",
        "className": "bpmn-icon-start-event-condition",
        "target": {
          "type": "bpmn:StartEvent",
          "eventDefinitionType": "bpmn:ConditionalEventDefinition",
          "isInterrupting": true
        },
        "actionName": "replace-with-conditional-start"
      },
      {
        "label": "Conditional intermediate catch event",
        "className": "bpmn-icon-intermediate-event-catch-condition",
        "target": {
          "type": "bpmn:IntermediateCatchEvent",
          "eventDefinitionType": "bpmn:ConditionalEventDefinition"
        },
        "actionName": "replace-with-conditional-intermediate-catch"
      }
    ],
    "bpmn:SignalEventDefinition": [
      {
        "label": "Signal start event",
        "className": "bpmn-icon-start-event-signal",
        "target": {
          "type": "bpmn:StartEvent",
          "eventDefinitionType": "bpmn:SignalEventDefinition",
          "isInterrupting": true
        },
        "actionName": "replace-with-signal-start"
      },
      {
        "label": "Signal intermediate catch event",
        "className": "bpmn-icon-intermediate-event-catch-signal",
        "target": {
          "type": "bpmn:IntermediateCatchEvent",
          "eventDefinitionType": "bpmn:SignalEventDefinition"
        },
        "actionName": "replace-with-signal-intermediate-catch"
      },
      {
        "label": "Signal intermediate throw event",
        "className": "bpmn-icon-intermediate-event-throw-signal",
        "target": {
          "type": "bpmn:IntermediateThrowEvent",
          "eventDefinitionType": "bpmn:SignalEventDefinition"
        },
        "actionName": "replace-with-signal-intermediate-throw"
      },
      {
        "label": "Signal end event",
        "className": "bpmn-icon-end-event-signal",
        "target": {
          "type": "bpmn:EndEvent",
          "eventDefinitionType": "bpmn:SignalEventDefinition"
        },
        "actionName": "replace-with-signal-end"
      }
    ],
    "bpmn:ErrorEventDefinition": [
      {
        "label": "Error start event",
        "className": "bpmn-icon-start-event-error",
        "target": {
          "type": "bpmn:StartEvent",
          "eventDefinitionType": "bpmn:ErrorEventDefinition",
          "isInterrupting": true
        },
        "actionName": "replace-with-error-start"
      },
      {
        "label": "Error end event",
        "className": "bpmn-icon-end-event-error",
        "target": {
          "type": "bpmn:EndEvent",
          "eventDefinitionType": "bpmn:ErrorEventDefinition"
        },
        "actionName": "replace-with-error-end"
      }
    ],
    "bpmn:EscalationEventDefinition": [
      {
        "label": "Escalation start event",
        "className": "bpmn-icon-start-event-escalation",
        "target": {
          "type": "bpmn:StartEvent",
          "eventDefinitionType": "bpmn:EscalationEventDefinition",
          "isInterrupting": true
        },
        "actionName": "replace-with-escalation-start"
      },
      {
        "label": "Escalation intermediate throw event",
        "className": "bpmn-icon-intermediate-event-throw-escalation",
        "target": {
          "type": "bpmn:IntermediateThrowEvent",
          "eventDefinitionType": "bpmn:EscalationEventDefinition"
        },
        "actionName": "replace-with-escalation-intermediate-throw"
      },
      {
        "label": "Escalation end event",
        "className": "bpmn-icon-end-event-escalation",
        "target": {
          "type": "bpmn:EndEvent",
          "eventDefinitionType": "bpmn:EscalationEventDefinition"
        },
        "actionName": "replace-with-escalation-end"
      }
    ],
    "bpmn:CompensateEventDefinition": [
      {
        "label": "Compensation start event",
        "className": "bpmn-icon-start-event-compensation",
        "target": {
          "type": "bpmn:StartEvent",
          "eventDefinitionType": "bpmn:CompensateEventDefinition",
          "isInterrupting": true
        },
        "actionName": "replace-with-compensation-start"
      },
      {
        "label": "Compensation intermediate throw event",
        "className": "bpmn-icon-intermediate-event-throw-compensation",
        "target": {
          "type": "bpmn:IntermediateThrowEvent",
          "eventDefinitionType": "bpmn:CompensateEventDefinition"
        },
        "actionName": "replace-with-compensation-intermediate-throw"
      },
      {
        "label": "Compensation end event",
        "className": "bpmn-icon-end-event-compensation",
        "target": {
          "type": "bpmn:EndEvent",
          "eventDefinitionType": "bpmn:CompensateEventDefinition"
        },
        "actionName": "replace-with-compensation-end"
      }
    ]
  }
};
