const HIDE_DELAY_MS = 900;
const timers = new WeakMap<Element, number>();

/** Reveal custom scrollbars only while the user is scrolling. */
export function installScrollbarReveal() {
  document.addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      target.classList.add("is-scrolling");
      const prev = timers.get(target);
      if (prev !== undefined) window.clearTimeout(prev);
      timers.set(
        target,
        window.setTimeout(() => {
          target.classList.remove("is-scrolling");
          timers.delete(target);
        }, HIDE_DELAY_MS),
      );
    },
    { capture: true, passive: true },
  );
}
