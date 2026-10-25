import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { useStore } from 'zustand';
import { useController, useLabels, useUi } from './context';
import { IconButton } from './controls';
import { Icon, type IconName } from './icons';

/** An icon per built-in suggestion (title, colour, transitions, canvas). */
const SUGGESTION_ICONS: readonly IconName[] = ['text', 'adjust', 'transition', 'canvas'];

/**
 * AI editing (v0.4): type what you want; the host's assistant answers with edits the editor
 * checks and applies as one undo step. Shown only when the host passes an `assistant`.
 */
export function AssistantPanel(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const turns = useUi((s) => s.assistantTurns);
  // The editor's current project: a turn's Undo shows while its changes are the latest step.
  const project = useStore(ctl.editor.store, (s) => s.project);
  const busy = useUi((s) => s.assistantBusy);
  const [text, setText] = useState('');
  // What was just sent: shown as your message at once, while the answer comes.
  const [pending, setPending] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const [sent, setSent] = useState(0);
  const send = (value: string) => {
    if (!value.trim() || busy) return;
    setText('');
    setPending(value.trim());
    setSent((n) => n + 1);
    void ctl.askAssistant(value);
  };
  const waiting = busy && pending !== null;
  // Sending brings your message to the top of the chat, so the answer appears under it in view;
  // the answer itself never moves the chat. A spacer under the newest exchange makes room for
  // that and shrinks as the answer fills it.
  const spacerRef = useRef<HTMLDivElement>(null);
  const fitSpacer = () => {
    const thread = threadRef.current;
    const spacer = spacerRef.current;
    const mine = thread?.querySelectorAll('.vu-assistant-you');
    const last = mine?.[mine.length - 1];
    if (!thread || !spacer || !last) return null;
    const gap = parseFloat(getComputedStyle(thread).paddingTop) || 0;
    const top = last.getBoundingClientRect().top - thread.getBoundingClientRect().top;
    const at = thread.scrollTop + top - gap; // where the chat scrolls to show it at the top
    const below = thread.scrollHeight - spacer.offsetHeight - (thread.scrollTop + top);
    spacer.style.height = `${Math.max(0, thread.clientHeight - gap - below)}px`;
    return at;
  };
  // Also on opening the panel: it shows the latest exchange, as right after sending.
  useLayoutEffect(() => {
    const at = fitSpacer();
    if (at !== null && threadRef.current) threadRef.current.scrollTop = at;
  }, [sent]);
  useLayoutEffect(() => {
    fitSpacer();
  }, [turns, waiting]);
  const empty = !text.trim();
  return (
    <div className="vu-panel-body vu-assistant">
      <div ref={threadRef} className="vu-assistant-thread">
        {turns.length === 0 && !waiting ? (
          <p className="vu-assistant-greeting">
            <Icon name="sparkle" size={20} />
            <span>{l.assistantIntro}</span>
          </p>
        ) : (
          <ol className="vu-assistant-turns" aria-live="polite">
            {turns.map((t) => {
              const state = t.error ? 'error' : t.undone || !t.applied ? 'none' : 'done';
              return (
                <li key={t.id} className="vu-assistant-turn">
                  <p className="vu-assistant-you">{t.instruction}</p>
                  <div className="vu-assistant-reply">
                    <span className="vu-assistant-avatar" aria-hidden="true">
                      <Icon name="sparkle" size={14} />
                    </span>
                    <div className="vu-assistant-reply-body">
                      {/* A rejected answer's reply would claim changes that weren't made. */}
                      {t.reply && !t.error ? <p>{t.reply}</p> : null}
                      <div className="vu-assistant-result" data-state={state}>
                        {state === 'done' ? <Icon name="check" size={14} /> : null}
                        {state === 'error' ? <Icon name="warning" size={14} /> : null}
                        <span>
                          {t.error
                            ? `${l.assistantNotApplied} — ${t.error}`
                            : t.undone
                              ? l.assistantUndone
                              : t.applied
                                ? l.assistantApplied(t.applied)
                                : l.assistantNothing}
                        </span>
                        {t.after && !t.undone && t.after === project ? (
                          <button
                            type="button"
                            className="vu-assistant-undo"
                            data-tooltip={l.assistantUndoTip}
                            onClick={() => ctl.undoAssistantTurn(t.id)}
                          >
                            {l.undo}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {waiting ? (
          <div className="vu-assistant-turn">
            <p className="vu-assistant-you">{pending}</p>
            <div className="vu-assistant-reply">
              <span className="vu-assistant-avatar" aria-hidden="true">
                <Icon name="sparkle" size={14} />
              </span>
              <div
                className="vu-assistant-reply-body vu-assistant-thinking"
                role="status"
                aria-live="polite"
              >
                <span className="vu-assistant-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span>{l.assistantThinking}</span>
              </div>
            </div>
          </div>
        ) : null}
        <div ref={spacerRef} className="vu-assistant-spacer" aria-hidden="true" />
      </div>
      <div className="vu-assistant-dock">
        <form
          className="vu-assistant-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <textarea
            className="vu-assistant-input"
            aria-label={l.assistant}
            placeholder={l.assistantPlaceholder}
            value={text}
            rows={2}
            onChange={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a new line.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
          />
          <div className="vu-assistant-composer-bar">
            {/* While it works, the send button stops it instead. */}
            {busy ? (
              <IconButton
                icon="stop"
                label={l.assistantStop}
                variant="primary"
                onClick={() => {
                  // Your words go back in the box, to change and send again.
                  setText(pending ?? '');
                  ctl.cancelAssistant();
                }}
              />
            ) : (
              <IconButton
                icon="arrowUp"
                label={l.assistantSend}
                variant="primary"
                shortcut="Enter"
                onClick={() => send(text)}
                disabledReason={empty ? l.assistantTypeFirst : null}
              />
            )}
          </div>
        </form>
        {turns.length === 0 && !busy ? (
          <ul className="vu-assistant-suggestions" aria-label={l.assistantTry}>
            {l.assistantExamples.map((e, i) => (
              <li key={e}>
                <button type="button" data-tooltip={e} onClick={() => send(e)}>
                  <Icon name={SUGGESTION_ICONS[i] ?? 'sparkle'} size={14} />
                  <span>{l.assistantExampleShort[i] ?? e}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="vu-assistant-privacy">{l.assistantPrivacy}</p>
      </div>
    </div>
  );
}
