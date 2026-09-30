// Marks a scrolling box with `more-below` while there is more under its bottom
// edge, so the stylesheet can fade that edge. Its content changes size as
// mail loads and rows open, so it is watched as well as its scrolling.
export function watchScrollFade(el: HTMLElement): () => void {
  let frame = 0;
  const update = () => {
    frame = 0;
    el.classList.toggle("more-below", el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };
  const soon = () => { if (!frame) frame = requestAnimationFrame(update); };
  el.addEventListener("scroll", soon, { passive: true });
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(soon);
  resize?.observe(el);
  const mutations = new MutationObserver(soon);
  mutations.observe(el, { childList: true, subtree: true });
  soon();
  return () => {
    el.removeEventListener("scroll", soon);
    resize?.disconnect();
    mutations.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
