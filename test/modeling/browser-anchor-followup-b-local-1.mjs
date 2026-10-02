import { runAnchorFollowups } from './browser-anchor-followup.mjs';
await runAnchorFollowups({ batch: 'b', engine: 'local', shardIndex: 0, shardCount: 3 });
