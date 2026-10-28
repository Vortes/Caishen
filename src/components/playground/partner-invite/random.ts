// mulberry32, keyed by a seed plus a salt per random stream, so changing
// one stream (say, the signature) never reshuffles another.
export function random(seed: number, salt: string) {
  let a = seed >>> 0;
  for (const char of salt) a = Math.imul(a ^ char.charCodeAt(0), 2654435761);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
