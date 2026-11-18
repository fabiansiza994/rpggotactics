/** Scoped browser defaults only. Never captures pointers or cancels game drag/target events. */
export function bindCardGestures(element: HTMLElement) {
  const editable = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
    );
  const context = (event: Event) => {
    if (!editable(event.target)) event.preventDefault();
  };
  const drag = (event: Event) => {
    const target = event.target;
    // Keep the deck editor's intentional draggable tiles working, including from their art.
    if (
      target instanceof Element &&
      target.tagName === "IMG" &&
      !target.closest('[draggable="true"]') &&
      !editable(target)
    )
      event.preventDefault();
  };
  element.addEventListener("contextmenu", context);
  element.addEventListener("dragstart", drag);
  return () => {
    element.removeEventListener("contextmenu", context);
    element.removeEventListener("dragstart", drag);
  };
}
