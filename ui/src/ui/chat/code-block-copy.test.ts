import { afterEach, describe, expect, it, vi } from "vitest";

import { enhanceCodeBlocks } from "./code-block-copy";

function createContainer(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

describe("enhanceCodeBlocks", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("adds copy button to pre elements", () => {
    const container = createContainer("<pre><code>hello</code></pre>");
    enhanceCodeBlocks(container);
    expect(container.querySelector(".code-copy-btn")).not.toBeNull();
    expect(container.querySelector(".code-block-wrapper")).not.toBeNull();
  });

  it("skips already-enhanced blocks (idempotency)", () => {
    const container = createContainer("<pre><code>hello</code></pre>");
    enhanceCodeBlocks(container);
    enhanceCodeBlocks(container);
    expect(container.querySelectorAll(".code-copy-btn")).toHaveLength(1);
  });

  it("copies code element textContent on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const container = createContainer("<pre><code>console.log(1)</code></pre>");
    enhanceCodeBlocks(container);

    const btn = container.querySelector(".code-copy-btn") as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("console.log(1)"));
  });

  it("falls back to pre textContent when no code child", () => {
    const container = createContainer("<pre>plain text</pre>");
    enhanceCodeBlocks(container);
    expect(container.querySelector(".code-copy-btn")).not.toBeNull();
  });

  it("enhances multiple code blocks", () => {
    const container = createContainer(
      "<pre><code>block 1</code></pre><pre><code>block 2</code></pre>",
    );
    enhanceCodeBlocks(container);
    expect(container.querySelectorAll(".code-copy-btn")).toHaveLength(2);
    expect(container.querySelectorAll(".code-block-wrapper")).toHaveLength(2);
  });

  it("shows error state when copy fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const container = createContainer("<pre><code>test</code></pre>");
    enhanceCodeBlocks(container);

    const btn = container.querySelector(".code-copy-btn") as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => {
      expect(btn.dataset.error).toBe("1");
      expect(btn.title).toBe("Copy failed");
    });
  });

  it("does not target inline code elements", () => {
    const container = createContainer("<p>Use <code>npm install</code> to install</p>");
    enhanceCodeBlocks(container);
    expect(container.querySelector(".code-copy-btn")).toBeNull();
  });
});
