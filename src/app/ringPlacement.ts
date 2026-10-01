type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

// The focus ring over a row, in window coordinates, with the parts of the row
// scrolled out of its list cut away so the ring never draws past the card
export function ringPlacement(row: Box, list: Box) {
  const cut = (n: number) => `${Math.round(Math.min(Math.max(n, 0), row.height))}px`;
  const top = cut(list.top - row.top);
  const bottom = cut(row.bottom - list.bottom);
  return {
    x: row.left,
    y: row.top,
    width: row.width,
    height: row.height,
    clip: `inset(${top} 0px ${bottom} 0px)`,
  };
}
