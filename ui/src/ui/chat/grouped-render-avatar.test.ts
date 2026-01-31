import { describe, expect, it } from "vitest";
import { render } from "lit";
import { renderMessageGroup } from "./grouped-render";

function renderToContainer(template: unknown): HTMLElement {
  const container = document.createElement("div");
  render(template as Parameters<typeof render>[0], container);
  return container;
}

function makeGroup(role: string) {
  return {
    role,
    timestamp: Date.now(),
    isStreaming: false,
    messages: [
      {
        key: "1",
        message: { role, content: [{ type: "text", text: "hello" }] },
      },
    ],
  };
}

describe("renderMessageGroup user identity", () => {
  it("shows 'You' as default user sender name", () => {
    const container = renderToContainer(
      renderMessageGroup(makeGroup("user"), { showReasoning: false }),
    );
    const senderName = container.querySelector(".chat-sender-name");
    expect(senderName?.textContent).toBe("You");
  });

  it("shows configured user name in sender footer", () => {
    const container = renderToContainer(
      renderMessageGroup(makeGroup("user"), {
        showReasoning: false,
        userName: "Jonathan",
      }),
    );
    const senderName = container.querySelector(".chat-sender-name");
    expect(senderName?.textContent).toBe("Jonathan");
  });

  it("shows first char of user name as avatar initial", () => {
    const container = renderToContainer(
      renderMessageGroup(makeGroup("user"), {
        showReasoning: false,
        userName: "Jonathan",
      }),
    );
    const avatar = container.querySelector(".chat-avatar.user");
    expect(avatar?.textContent).toBe("J");
  });

  it("renders img tag for user avatar URL", () => {
    const container = renderToContainer(
      renderMessageGroup(makeGroup("user"), {
        showReasoning: false,
        userName: "Jonathan",
        userAvatar: "https://example.com/avatar.png",
      }),
    );
    const img = container.querySelector("img.chat-avatar.user");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/avatar.png");
  });

  it("renders emoji avatar for non-URL user avatar", () => {
    const container = renderToContainer(
      renderMessageGroup(makeGroup("user"), {
        showReasoning: false,
        userAvatar: "\u{1F9D1}",
      }),
    );
    const avatar = container.querySelector(".chat-avatar.user");
    expect(avatar?.tagName).toBe("DIV");
    expect(avatar?.textContent).toContain("\u{1F9D1}");
  });

  it("falls back to Y initial when no user identity provided", () => {
    const container = renderToContainer(
      renderMessageGroup(makeGroup("user"), { showReasoning: false }),
    );
    const avatar = container.querySelector(".chat-avatar.user");
    expect(avatar?.textContent).toBe("Y");
  });

  it("does not affect assistant avatar rendering", () => {
    const container = renderToContainer(
      renderMessageGroup(makeGroup("assistant"), {
        showReasoning: false,
        assistantName: "Bot",
        assistantAvatar: "https://example.com/bot.png",
        userName: "Jonathan",
        userAvatar: "https://example.com/user.png",
      }),
    );
    const img = container.querySelector("img.chat-avatar.assistant");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://example.com/bot.png");
    // User avatar should not appear anywhere in the assistant group
    const userImg = container.querySelector("img.chat-avatar.user");
    expect(userImg).toBeNull();
  });
});
