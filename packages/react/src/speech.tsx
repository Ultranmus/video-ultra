import type { SpeechVoice, TextItem } from '@video-ultra/core';
import { useEffect, useState, type ReactElement } from 'react';
import { useController, useLabels, useUi } from './context';
import { Button, Chips } from './controls';

/**
 * Text to speech (v0.4): "Text to speech" in the Audio panel (type, pick a voice, add it at the
 * playhead) and "Read aloud" for a text (its words, added where it starts). Shown only when the
 * host gives the editor a voice service.
 */

function useVoices(): SpeechVoice[] {
  const ctl = useController();
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.resolve(ctl.options.speech?.voices() ?? []).then((v) => {
      if (live) setVoices(v);
    });
    return () => {
      live = false;
    };
  }, [ctl]);
  return voices;
}

function VoiceControls({
  voice,
  setVoice,
  speed,
  setSpeed,
}: {
  voice: string | null;
  setVoice: (v: string) => void;
  speed: number;
  setSpeed: (v: number) => void;
}): ReactElement {
  const l = useLabels();
  const voices = useVoices();
  return (
    <>
      {voices.length > 1 ? (
        <Chips
          label={l.speechVoice}
          value={voice ?? voices[0]!.id}
          options={voices.map((v) => ({ value: v.id, label: v.name }))}
          onChange={setVoice}
        />
      ) : null}
      <div className="vu-field">
        <label className="vu-field-row">
          <span>{l.speechSpeed}</span>
          <output>{`${speed.toFixed(2)}×`}</output>
        </label>
        <input
          className="vu-range"
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={speed}
          aria-label={l.speechSpeed}
          onChange={(e) => setSpeed(Number(e.currentTarget.value))}
        />
      </div>
    </>
  );
}

function Busy(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  return (
    <div className="vu-caption-job" role="status" aria-live="polite">
      <div className="vu-caption-job-head">
        <span className="vu-spinner" aria-hidden="true" />
        <span>{l.speechMaking}</span>
        <Button label={l.cancel} variant="secondary" onClick={() => ctl.cancelSpeech()} />
      </div>
    </div>
  );
}

/** Audio panel: type text, add it as a voice at the playhead. */
export function TextToSpeech(): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const busy = useUi((s) => s.speechBusy);
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  if (!ctl.options.speech) return null;
  return (
    <section className="vu-tts" aria-label={l.textToSpeech}>
      <h3 className="vu-audiolib-title">{l.textToSpeech}</h3>
      <textarea
        className="vu-textarea vu-assistant-input"
        aria-label={l.textToSpeech}
        placeholder={l.speechPlaceholder}
        value={text}
        rows={3}
        onChange={(e) => setText(e.currentTarget.value)}
      />
      <VoiceControls voice={voice} setVoice={setVoice} speed={speed} setSpeed={setSpeed} />
      {busy ? (
        <Busy />
      ) : (
        <Button
          icon="audio"
          label={l.speechMake}
          variant="primary"
          disabledReason={!text.trim() ? l.speechPlaceholder : null}
          onClick={() =>
            void ctl.speak(text, { ...(voice ? { voice } : {}), speed }).then((ok) => {
              if (ok) setText('');
            })
          }
        />
      )}
      <p className="vu-hint">{l.speechHint}</p>
    </section>
  );
}

/** A text's "Read aloud": its words as a voice clip where it starts. */
export function ReadAloudTool({ item }: { item: TextItem }): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const busy = useUi((s) => s.speechBusy);
  const [voice, setVoice] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  if (!ctl.options.speech) return null;
  return (
    <div className="vu-tts">
      <VoiceControls voice={voice} setVoice={setVoice} speed={speed} setSpeed={setSpeed} />
      {busy ? (
        <Busy />
      ) : (
        <Button
          icon="audio"
          label={l.readAloud}
          variant="primary"
          tip={l.tipReadAloud}
          onClick={() =>
            void ctl.speak(item.text, { ...(voice ? { voice } : {}), speed, at: item.start })
          }
        />
      )}
    </div>
  );
}
