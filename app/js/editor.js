/** A textarea remains usable if the optional syntax-highlighting CDN is unavailable. */
export function initializeWeightEditor(textarea, onChange) {
  let editor = null, muted = false;
  const notify = () => { if (!muted) onChange(); };
  textarea.addEventListener('input', notify);
  const api = {
    getValue: () => editor ? editor.getValue() : textarea.value,
    setValue(value) {
      muted = true;
      if (editor) editor.setValue(value); else textarea.value = value;
      muted = false;
    },
    refresh: () => editor?.refresh(),
  };
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = url;
      script.onload = resolve; script.onerror = reject; document.head.append(script);
    });
  }
  const base = 'https://cdn.jsdelivr.net/npm/codemirror@5.65.16';
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = `${base}/lib/codemirror.css`;
  document.head.append(stylesheet);
  loadScript(`${base}/lib/codemirror.js`).then(() => loadScript(`${base}/mode/javascript/javascript.js`)).then(() => {
    editor = window.CodeMirror.fromTextArea(textarea, {
      mode: 'javascript', lineNumbers: true, indentUnit: 2, tabSize: 2, lineWrapping: true,
      viewportMargin: 10, extraKeys: { Tab: cm => cm.replaceSelection('  ', 'end'), Esc: cm => cm.getInputField().blur() },
    });
    editor.getInputField().setAttribute('aria-label', 'Weight function code');
    editor.on('change', notify);
    textarea.style.display = 'none';
    new ResizeObserver(() => editor.refresh()).observe(textarea.parentElement);
  }).catch(() => {
    // Keep the plain-text editor usable when syntax highlighting cannot load.
  });
  return api;
}
