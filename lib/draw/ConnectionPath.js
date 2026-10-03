/**
 * Rounded connection paint with a shared budget for each internal segment.
 *
 * Adapted from diagram-js 15.27.1 util/RenderUtil.js (MIT):
 * https://github.com/bpmn-io/diagram-js/blob/v15.27.1/lib/util/RenderUtil.js
 * Copyright (c) 2014-present Camunda Services GmbH.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import { componentsToPath } from 'diagram-js/lib/util/RenderUtil';

const distance = (a, b) => Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
const towards = (start, end, length) => {
  const fraction = length / distance(start, end);
  return { x: start.x + (end.x - start.x) * fraction,
    y: start.y + (end.y - start.y) * fraction };
};

/**
 * Do not change authored waypoints or endpoints. Only shorten overlapping
 * corner cutbacks: independently consuming the full short segment from both
 * ends would paint a backwards line between two otherwise forward curves.
 * Compute both constraints from the original radii so reversing the route
 * does not change how a contested segment is shared.
 */
export function connectionPath(waypoints, cornerRadius = 5) {
  if (!waypoints.length) return '';
  const lengths = waypoints.slice(1).map((point, index) => distance(waypoints[index], point));
  const radii = waypoints.map((_, index) => index && index < waypoints.length - 1
    ? Math.min(cornerRadius, lengths[index - 1], lengths[index]) : 0);
  const shares = lengths.map((length, index) => {
    const total = radii[index] + radii[index + 1];
    return total > length ? length / total : 1;
  });
  const path = [['M', waypoints[0].x, waypoints[0].y]];
  for (let index = 1; index < waypoints.length; index++) {
    const point = waypoints[index];
    const radius = radii[index] * Math.min(shares[index - 1], shares[index] ?? 1);
    if (!radius) {
      path.push(['L', point.x, point.y]);
      continue;
    }
    const before = towards(point, waypoints[index - 1], radius);
    const beforeControl = towards(point, waypoints[index - 1], radius * .5);
    const after = towards(point, waypoints[index + 1], radius);
    const afterControl = towards(point, waypoints[index + 1], radius * .5);
    path.push(['L', before.x, before.y]);
    path.push(['C', beforeControl.x, beforeControl.y, afterControl.x, afterControl.y, after.x, after.y]);
  }
  return componentsToPath(path);
}
