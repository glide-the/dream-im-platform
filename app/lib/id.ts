export function createId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 9);
  const time = Date.now().toString(36);
  return `${prefix}_${time}_${random}`;
}

export function stableHash(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
