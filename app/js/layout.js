/** Enable pointer and keyboard resizing without coupling layout to the renderers. */
export function initializeLayout() {
  const workspace = document.getElementById('workspace');
  const viewers = document.getElementById('viewers');
  const vertical = document.getElementById('vertical-splitter');
  const horizontal = document.getElementById('horizontal-splitter');
  let leftPercent = 50;
  let inspectorHeight = 280;

  function setLeftPercent(value) {
    leftPercent = Math.max(25, Math.min(75, value));
    // Percentages apply to the available space after the separator.
    viewers.style.setProperty('--left-width', `calc((100% - 10px) * ${leftPercent / 100})`);
    vertical.setAttribute('aria-valuenow', Math.round(leftPercent));
  }
  function setInspectorHeight(value) {
    const maximum = Math.max(150, Math.min(600, workspace.clientHeight - 314));
    inspectorHeight = Math.max(150, Math.min(maximum, value));
    workspace.style.setProperty('--inspector-height', `${inspectorHeight}px`);
    horizontal.setAttribute('aria-valuemax', Math.round(maximum));
    horizontal.setAttribute('aria-valuenow', Math.round(inspectorHeight));
  }
  function bindDrag(element, update) {
    let pointerId = null;
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      element.setPointerCapture(pointerId);
      event.preventDefault();
    });
    element.addEventListener('pointermove', event => {
      if (event.pointerId === pointerId) update(event);
    });
    const endDrag = () => { pointerId = null; };
    element.addEventListener('pointerup', endDrag);
    element.addEventListener('pointercancel', endDrag);
    element.addEventListener('lostpointercapture', endDrag);
  }
  bindDrag(vertical, event => {
    const bounds = viewers.getBoundingClientRect();
    setLeftPercent((event.clientX - bounds.left - 5) / (bounds.width - 10) * 100);
  });
  bindDrag(horizontal, event => setInspectorHeight(workspace.getBoundingClientRect().bottom - event.clientY - 7));
  vertical.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    setLeftPercent(event.key === 'Home' ? 50 : leftPercent + (event.key === 'ArrowRight' ? 2 : -2));
  });
  horizontal.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    setInspectorHeight(event.key === 'Home' ? 280 : inspectorHeight + (event.key === 'ArrowUp' ? 16 : -16));
  });
  const observer = new ResizeObserver(() => setInspectorHeight(inspectorHeight));
  observer.observe(workspace);
  setLeftPercent(leftPercent);
  setInspectorHeight(inspectorHeight);
  return { setInspectorHeight };
}
