import { runPreviewMotion } from './browser-anchor-preview-motion.mjs';
await runPreviewMotion({ gatewayPolicy: 'vertices', outlinePolicy: 'outward', shardIndex: 0, shardCount: 2, basePort: 5410 });
