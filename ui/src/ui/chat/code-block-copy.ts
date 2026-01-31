const COPIED_FOR_MS = 1500;
const ERROR_FOR_MS = 2000;
const COPY_LABEL = "Copy code";
const COPIED_LABEL = "Copied";
const ERROR_LABEL = "Copy failed";
const ENHANCED_ATTR = "data-code-copy";

const COPY_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const CHECK_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

function setLabel(btn: HTMLButtonElement, label: string): void {
  btn.title = label;
  btn.setAttribute("aria-label", label);
}

function createCodeCopyButton(pre: HTMLElement): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "code-copy-btn";
  btn.type = "button";
  setLabel(btn, COPY_LABEL);
  btn.innerHTML = `<span class="code-copy-btn__icon" aria-hidden="true"><span class="code-copy-btn__icon-copy">${COPY_SVG}</span><span class="code-copy-btn__icon-check">${CHECK_SVG}</span></span>`;

  btn.addEventListener("click", async () => {
    if (btn.dataset.copying === "1") return;

    const code = pre.querySelector("code");
    const text = (code ?? pre).textContent ?? "";
    if (!text) return;

    btn.dataset.copying = "1";
    btn.setAttribute("aria-busy", "true");
    btn.disabled = true;

    let success = false;
    try {
      await navigator.clipboard.writeText(text);
      success = true;
    } catch {
      /* clipboard access denied */
    }

    if (!btn.isConnected) return;
    delete btn.dataset.copying;
    btn.removeAttribute("aria-busy");
    btn.disabled = false;

    if (!success) {
      btn.dataset.error = "1";
      setLabel(btn, ERROR_LABEL);
      window.setTimeout(() => {
        if (!btn.isConnected) return;
        delete btn.dataset.error;
        setLabel(btn, COPY_LABEL);
      }, ERROR_FOR_MS);
      return;
    }

    btn.dataset.copied = "1";
    setLabel(btn, COPIED_LABEL);
    window.setTimeout(() => {
      if (!btn.isConnected) return;
      delete btn.dataset.copied;
      setLabel(btn, COPY_LABEL);
    }, COPIED_FOR_MS);
  });

  return btn;
}

/** Walk all `<pre>` elements inside `container` and inject a copy button into each. */
export function enhanceCodeBlocks(container: HTMLElement): void {
  const pres = container.querySelectorAll<HTMLPreElement>("pre");

  for (const pre of pres) {
    if (pre.hasAttribute(ENHANCED_ATTR)) continue;
    const parent = pre.parentNode;
    if (!parent) continue;
    pre.setAttribute(ENHANCED_ATTR, "");

    const wrapper = document.createElement("div");
    wrapper.className = "code-block-wrapper";
    parent.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    wrapper.appendChild(createCodeCopyButton(pre));
  }
}

/**
 * Lit `ref` callback -- call from the `.chat-text` div.
 * Defers via rAF to ensure `unsafeHTML` content is committed.
 */
export function codeBlockCopyRef(el: Element | undefined): void {
  if (!(el instanceof HTMLElement)) return;
  requestAnimationFrame(() => {
    if (el.isConnected) enhanceCodeBlocks(el);
  });
}
