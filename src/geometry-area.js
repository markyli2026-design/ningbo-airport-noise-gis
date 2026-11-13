// Spherical footprint area for the displayed vector-tile polygon.
export function area(polygons) {
  const radians = Math.PI / 180;
  const earthRadius = 6371008.8;
  function ringArea(ring) {
    let sum = 0;
    for (let i = 1; i < ring.length; i++) {
      const [a,b] = ring[i-1], [c,d] = ring[i];
      sum += (c-a)*radians*(Math.sin(b*radians)+Math.sin(d*radians));
    }
    return Math.abs(sum)*earthRadius**2/2;
  }
  return polygons.reduce((total, [outer,...holes]) =>
    total + ringArea(outer) - holes.reduce((sum,ring) => sum+ringArea(ring),0),0);
}
