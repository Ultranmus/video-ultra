import { useState, type ReactElement } from 'react';
import { useController, useLabels, useUi } from './context';
import { Button, Chips } from './controls';

/**
 * AI editing (v0.4): type what you want; the host's assistant answers with edits the editor
 * checks and applies as one undo step. Shown only when the host passes an `assistant`.
 */
export function AssistantPanel(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const turns = useUi((s) => s.assistantTurns);
  const busy = useUi((s) => s.assistantBusy);
  const [text, setText] = useState('');
  const send = (value: string) => {
    if (!value.trim() || busy) return;
    setText('');
    void ctl.askAssistant(value);
  };
  return (
    <div className="vu-assistant">
      {turns.length === 0 ? (
        <Chips
          label={l.assistant}
          hideLabel
          value={null}
          options={l.assistantExamples.map((e) => ({ value: e, label: e }))}
          onChange={(e) => send(e)}
        />
      ) : (
        <ol className="vu-assistant-turns" aria-live="polite">
          {turns.map((t) => (
            <li key={t.id} className="vu-assistant-turn">
              <p className="vu-assistant-you">{t.instruction}</p>
              {t.reply ? <p className="vu-assistant-reply">{t.reply}</p> : null}
              <p
                className="vu-assistant-result"
                data-state={t.error ? 'error' : t.applied ? 'done' : 'none'}
              >
                {t.error
                  ? `${l.assistantNotApplied} — ${t.error}`
                  : t.applied
                    ? l.assistantApplied(t.applied)
                    : l.assistantNothing}
              </p>
            </li>
          ))}
        </ol>
      )}
      {busy ? (
        <div className="vu-caption-job" role="status" aria-live="polite">
          <div className="vu-caption-job-head">
            <span className="vu-spinner" aria-hidden="true" />
            <span>{l.assistantThinking}</span>
            <Button label={l.cancel} variant="secondary" onClick={() => ctl.cancelAssistant()} />
          </div>
        </div>
      ) : null}
      <form
        className="vu-assistant-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <textarea
          className="vu-textarea vu-assistant-input"
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
        <Button
          icon="sparkle"
          label={l.assistantSend}
          variant="primary"
          onClick={() => send(text)}
          disabledReason={busy ? l.assistantThinking : !text.trim() ? l.assistantPlaceholder : null}
        />
      </form>
      <p className="vu-hint">{l.assistantPrivacy}</p>
    </div>
  );
}
