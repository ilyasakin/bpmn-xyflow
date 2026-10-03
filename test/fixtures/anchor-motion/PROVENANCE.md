# Native Event motion evidence

`start-low-motion.bpmn` is the XML exported after the visible Empty-diagram,
Delete, wheel-zoom and palette-Start setup in the October 3 preview-motion
baseline. `start-low-motion.json` retains the exact camera, shape geometry and
59 trusted integer mouse positions of its slow forward/reverse path. Generated
IDs are retained. The test derives expected docks independently from the circle;
it does not use recorded marker or grab coordinates as expected output.

Source: library commit `cbd1a0afbbd5402f7c1d9e78769e94ed8ded3f0c`,
[Actions run 37082800733](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/37082800733),
case `MOTION-Start-local-selected-low`. This authored QA fixture contains no
customer model. Structural replay is not native hit-testing or timing evidence.

The `task-low`, `task-normal-retina`, `start-calibrated-low`,
`start-calibrated-normal`, and `boundary-calibrated` pairs come from the next
hosted diagnostic at `7dcc2a9`, after native wheel calibration reached the intended
zoom. Their JSON records the case and actual camera/receiver coordinates. Task
pairs retain the exact failing transition window; Event pairs retain every slow
phase input. XML is the unmodified post-case export. No recorded output anchor is
used as expected geometry.

The earlier setup events for `start-calibrated-low` were outside the retained
input tail. Its structural test explicitly reconstructs the adjacent input that
creates the exact recorded pre-phase marker; it does not claim that this was an
observed native setup event. The context-pad rectangle in structural Event tests
is derived from the declared stock CSS grid and shape bounds, because Happy DOM
has no layout. Hosted acceptance retains the actual browser hit/layout checks.
