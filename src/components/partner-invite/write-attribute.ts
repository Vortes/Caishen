import { BufferAttribute, type BufferGeometry } from "three";

// Writes per-frame vertex data into a geometry, refilling the buffer it
// already has rather than handing the GPU a new one every frame.
export function writeAttribute(
  geometry: BufferGeometry,
  name: string,
  values: ArrayLike<number>,
  itemSize: number,
) {
  const attribute = geometry.getAttribute(name);
  if (
    attribute instanceof BufferAttribute &&
    attribute.count * itemSize === values.length
  ) {
    attribute.array.set(values);
    attribute.needsUpdate = true;
    return;
  }
  geometry.setAttribute(
    name,
    new BufferAttribute(Float32Array.from(values), itemSize),
  );
}
