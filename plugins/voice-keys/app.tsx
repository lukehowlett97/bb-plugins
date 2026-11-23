// bb-plugin-voice-keys — keyboard keys for bb's voice input.
//
// While a composer is recording, bb shows two buttons in place of the usual
// send button: "Stop and add to draft" and "Send voice input". This content
// script maps keys to them:
//
//   Enter  →  Send voice input      (same as clicking send)
//   Space  →  Stop and add to draft (same as clicking that button)
//
// Only while one of those buttons is on screen and enabled; otherwise the
// keys do what they always do. A key with a modifier, a held-key repeat, and
// typing in some other text field are left alone.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

const SEND = 'button[aria-label="Send voice input"]';
const ADD = 'button[aria-label="Stop and add to draft"]';

function visible(el: HTMLElement): boolean {
  return el.isConnected && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0;
}

// The recording buttons on screen, preferring the composer that holds focus
// when more than one composer is recording.
function recordingButton(selector: string, focus: Element | null): HTMLButtonElement | null {
  const all = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).filter(visible);
  if (all.length <= 1) return all[0] ?? null;
  for (let node = focus; node; node = node.parentElement) {
    const inside = all.find((b) => node!.contains(b));
    if (inside) return inside;
  }
  return all[0];
}

// The composer a recording button belongs to: its nearest ancestor that also
// holds a text editor.
function composerOf(button: HTMLElement): HTMLElement | null {
  for (let node = button.parentElement; node && node !== document.body; node = node.parentElement) {
    if (node.querySelector('[contenteditable="true"], textarea')) return node;
  }
  return null;
}

// True when the key is typed into a field other than the recording
// composer's own editor (a search box, a rename field), so it must stay text.
function typingElsewhere(target: EventTarget | null, button: HTMLElement): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const field =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable;
  if (!field) return false;
  const composer = composerOf(button);
  return !(composer && composer.contains(target));
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "voice-keys",
    mount({ signal }) {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.defaultPrevented || event.repeat || event.isComposing) return;
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const isEnter = event.key === "Enter";
        const isSpace = event.key === " " || event.code === "Space";
        if (!isEnter && !isSpace) return;
        // A key pressed on another button (e.g. Space on a focused button)
        // keeps its usual meaning.
        if (isSpace && event.target instanceof HTMLButtonElement) return;
        const button = recordingButton(isEnter ? SEND : ADD, document.activeElement);
        if (!button) return;
        if (typingElsewhere(event.target, button)) return;
        event.preventDefault();
        event.stopPropagation();
        button.click();
      };
      // Capture phase, so the editor never sees the key (no newline, no
      // space typed, no empty send) while dictation owns it.
      window.addEventListener("keydown", onKeyDown, { capture: true, signal });
      return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
    },
  });
});
