/** UI-only follow-up runner. All cases are PREPARED/UNRUN until hosted execution. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createAnchorHarness } from "../helpers/anchor-ux-browser.mjs";
import { selectAnchorCases } from "../helpers/anchor-case-deadline.mjs";
import {
  assertFollowupPortClosed,
  runFollowupCases,
  selectFollowupShard,
} from "../helpers/anchor-followup-lifecycle.mjs";
import { beginFollowupEvidence } from "../helpers/anchor-followup-controls.mjs";
import { anchorEditCases } from "./anchor-followup-edits.mjs";
import { anchorInterruptionCases } from "./anchor-followup-interruptions.mjs";

export async function registeredAnchorFollowups() {
  const { anchorShapeCases } = await import("./anchor-followup-shapes.mjs");
  const { anchorInstanceCases } = await import("./anchor-followup-instances.mjs");
  return [
    ...anchorEditCases.map((c) => ({ ...c, batch: "a" })),
    ...anchorShapeCases.map((c) => ({ ...c, batch: "b" })),
    ...[...anchorInterruptionCases, ...anchorInstanceCases].map((c) => ({ ...c, batch: "c" })),
  ];
}
export async function runAnchorFollowups(
  options = {},
  {
    harnessFactory = createAnchorHarness,
    registerCases = registeredAnchorFollowups,
    artifactRoot = "test-artifacts",
  } = {},
) {
  const all = await registerCases(),
    cases = selectFollowupShard(selectAnchorCases(all, options), options);
  if (options.list) {
    console.log(
      JSON.stringify(
        cases.map(({ run: _run, ...c }) => ({ ...c, status: "prepared-unrun" })),
        null,
        2,
      ),
    );
    return;
  }
  assert.ok(
    ["a", "b", "c"].includes(options.batch) && ["local", "upstream"].includes(options.engine),
    "Execution requires explicit --batch and --engine to isolate native jobs",
  );
  const suffix = `${options.batch}-${options.engine}${options.id ? "-" + options.id : ""}${(options.shardCount ?? 1) > 1 ? `-shard-${options.shardIndex ?? 0}-of-${options.shardCount}` : ""}`;
  const output = `${artifactRoot}/anchor-followup-${suffix}`;
  const basePort = Number(
    process.env.BPMN_ANCHOR_FOLLOWUP_PORT ||
      {
        "a-local": 5254,
        "a-upstream": 5256,
        "b-local": 5257,
        "b-upstream": 5258,
        "c-local": 5259,
      }[`${options.batch}-${options.engine}`],
  );
  const persist = async (filename, snapshot, signal) => {
    await mkdir(output, { recursive: true });
    signal.throwIfAborted();
    await writeFile(`${output}/${filename}`, JSON.stringify(snapshot, null, 2), { signal });
  };
  const results = await runFollowupCases(cases, {
    createHarness: (_c, index) => harnessFactory({ port: basePort + index, output }),
    verifyStopped: (_h, _c, index) => assertFollowupPortClosed(basePort + index),
    prepare: async (h, page, key, c) => {
      beginFollowupEvidence(page, key);
      await h.save(page, key + "-initial", {
        id: c.id,
        name: c.name,
        engine: c.engine,
        sample: c.sample,
      });
    },
    captureFailure: async (h, page, key, error, signal) => {
      await page.screenshot({ path: `${output}/${key}-failure.png`, fullPage: true });
      signal.throwIfAborted();
      const raw = await h.raw(page);
      signal.throwIfAborted();
      await writeFile(`${output}/${key}-failure.bpmn`, raw.xml, { signal });
      await writeFile(
        `${output}/${key}-failure.json`,
        JSON.stringify({ error: String(error), state: raw }, null, 2),
        { signal },
      );
    },
    // Unique progress files prevent a late filesystem completion from
    // overwriting a newer case or the final aggregate after its deadline.
    persistProgress: (snapshot, index, signal) =>
      persist(`results-progress-${String(index + 1).padStart(3, "0")}.json`, snapshot, signal),
    persistAggregate: (snapshot, signal) => persist("results.json", snapshot, signal),
  });
  assert.equal(
    results.length,
    cases.length,
    "every case has an attempted result or explicit blocked record",
  );
  const failed = results.filter((r) => r.status !== "passed");
  console.log(
    `Anchor follow-up ${suffix}: ${cases.length - failed.length}/${cases.length} passed; ${results.filter((r) => r.status === "blocked").length} blocked`,
  );
  assert.equal(
    failed.length,
    0,
    `${failed.length} native follow-up cases failed or were blocked; see ${output}/results.json`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const match = /^--(batch|case|engine|shard-index|shard-count)=(.+)$/.exec(arg);
      if (arg === "--list") return ["list", true];
      if (!match) throw new Error(`Unknown argument ${arg}`);
      if (match[1] === "shard-index" || match[1] === "shard-count")
        return [match[1] === "shard-index" ? "shardIndex" : "shardCount", Number(match[2])];
      return [match[1] === "case" ? "id" : match[1], match[2]];
    }),
  );
  await runAnchorFollowups(args);
}
