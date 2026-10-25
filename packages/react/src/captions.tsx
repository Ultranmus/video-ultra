import {
  CAPTION_PRESETS,
  captionTrack,
  FLICKS_PER_SECOND,
  itemEnd,
  type CaptionLook,
  type CaptionPreset,
  type TextItem,
  type TranscriberCheck,
} from '@video-ultra/core';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useController, useLabels, useProject, useUi } from './context';
import { WholeVideoOnly } from './multiedit';
import { Button, Chips, ColorField, IconButton, Section, Segmented } from './controls';
import { formatClock, languageName } from './format';
import { Icon } from './icons';

/**
 * The Captions panel (v0.2 A): make captions from the speech, import a subtitle file or type
 * them; then one look for all of them (style preset, word highlight, position, size), the list
 * of captions to read and fix, and the subtitle file to download. Captions are burned into the
 * export like any text.
 */

/**
 * Languages offered for auto captions when the transcriber doesn't list its own (ISO 639-1;
 * the ones speech-to-text services commonly hear, DECISIONS #164): the most used first, the rest
 * behind "More languages…" with a search. Names come from the browser, translated.
 */
const LANGUAGES: readonly string[] = [
  'en',
  'hi',
  // Hinglish: Hindi written in Latin letters, the way it's typed (DECISIONS #168).
  'hi-Latn',
  'es',
  'fr',
  'de',
  'pt',
  'it',
  'nl',
  'id',
  'tr',
  'ru',
  'ar',
  'bn',
  'ur',
  'ta',
  'te',
  'mr',
  'zh',
  'ja',
  'ko',
  'vi',
  'th',
  'fa',
  'pl',
  'uk',
  'gu',
  'kn',
  'ml',
  'pa',
  'ne',
  'af',
  'am',
  'as',
  'az',
  'ba',
  'be',
  'bg',
  'bo',
  'br',
  'bs',
  'ca',
  'cs',
  'cy',
  'da',
  'el',
  'et',
  'eu',
  'fi',
  'fo',
  'gl',
  'ha',
  'he',
  'hr',
  'ht',
  'hu',
  'hy',
  'is',
  'ka',
  'kk',
  'km',
  'la',
  'lb',
  'ln',
  'lo',
  'lt',
  'lv',
  'mg',
  'mi',
  'mk',
  'mn',
  'ms',
  'mt',
  'my',
  'nn',
  'no',
  'oc',
  'ps',
  'ro',
  'sa',
  'sd',
  'si',
  'sk',
  'sl',
  'sn',
  'so',
  'sq',
  'sr',
  'su',
  'sv',
  'sw',
  'tg',
  'tk',
  'tl',
  'tt',
  'uz',
  'yi',
  'yo',
];

/** The browser's language, if auto captions offer it. */
function browserLanguage(offered: readonly string[]): string | null {
  const code = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : '';
  return offered.includes(code) ? code : null;
}

/** The language to start with: last used, else the browser's, else the first offered. */
function startLanguage(offered: readonly string[], detect: boolean): string {
  try {
    const saved = localStorage.getItem('video-ultra:caption-language');
    if (saved && (offered.includes(saved) || (detect && saved === 'auto'))) return saved;
  } catch {
    /* storage blocked */
  }
  return browserLanguage(offered) ?? offered[0] ?? 'auto';
}

/** A per-browser convenience value (storage may be blocked: then nothing is kept). */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

/** "Priya, Goa;  Ultranmus" → ["Priya", "Goa", "Ultranmus"] (at most 30). */
function wordList(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 30);
}

export function CaptionsPanel(): ReactElement {
  const l = useLabels();
  const has = useProject((p) => (captionTrack(p)?.items.length ?? 0) > 0);
  const inside = useUi((s) => s.inside.length > 0);
  if (inside)
    return (
      <div className="vu-panel-body vu-captions">
        <WholeVideoOnly message={l.captionsWholeVideo} />
      </div>
    );
  return (
    <div className="vu-panel-body vu-captions">
      <AutoCaptions has={has} />
      <CaptionSources />
      {has ? (
        <>
          <CaptionLookControls />
          <CaptionList />
          <CaptionDownload />
          <p className="vu-hint">{l.captionsBurnedIn}</p>
        </>
      ) : null}
    </div>
  );
}

function AutoCaptions({ has }: { has: boolean }): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const job = useUi((s) => s.captionJob);
  // The transcriber's own languages (e.g. English only on the device), else the panel's list.
  const own = ctl.options.transcriber?.languages;
  const offered = own ? own.filter((code) => code !== 'auto') : LANGUAGES;
  const detect = !own || own.includes('auto');
  const [language, setLanguage] = useState(() => startLanguage(offered, detect));
  const [check, setCheck] = useState<TranscriberCheck | null>(null);
  const [allLanguages, setAllLanguages] = useState(false);
  const [find, setFind] = useState('');
  const available = !!ctl.options.transcriber;
  const takesWords = !!ctl.options.transcriber?.takesVocabulary;
  // Names & words, kept per project in this browser (a convenience).
  const wordsKey = `video-ultra:caption-words:${ctl.project.id}`;
  const [vocabulary, setVocabulary] = useState(() => stored(wordsKey) ?? '');
  useEffect(() => {
    let live = true;
    void ctl.checkCaptions(language).then((c) => live && setCheck(c));
    return () => {
      live = false;
    };
  }, [ctl, language]);
  const duration = useProject((p) =>
    p.tracks[0] ? p.tracks.reduce((m, t) => Math.max(m, ...t.items.map(itemEnd)), 0) : 0,
  );
  if (!available) return <p className="vu-hint">{l.captionsUnavailable}</p>;
  const minutes =
    check?.speed && duration > 0 ? duration / FLICKS_PER_SECOND / check.speed / 60 : null;
  const pick = (code: string) => {
    setLanguage(code);
    try {
      localStorage.setItem('video-ultra:caption-language', code);
    } catch {
      /* storage blocked */
    }
  };
  return (
    <Section title={l.autoCaptions}>
      <p className="vu-hint">{l.autoCaptionsBody}</p>
      {offered.length === 1 && !detect ? (
        <p className="vu-hint">{l.spokenLanguageOnly(languageName(offered[0]!))}</p>
      ) : (
        <Chips
          label={l.spokenLanguage}
          value={language}
          // The first two, Detect, Hinglish when offered, the chosen / browser's one, "More…".
          options={[
            ...offered.slice(0, 2).map((code) => ({ value: code, label: languageName(code) })),
            ...(detect ? [{ value: 'auto', label: l.detectLanguage }] : []),
            ...offered
              .slice(2)
              .filter(
                (code) =>
                  code === 'hi-Latn' || code === language || code === browserLanguage(offered),
              )
              .map((code) => ({ value: code, label: languageName(code) })),
            ...(allLanguages || offered.length <= 2
              ? []
              : [{ value: 'more', label: l.moreLanguages }]),
          ]}
          onChange={(code) => (code === 'more' ? setAllLanguages(true) : pick(code))}
        />
      )}
      {allLanguages ? (
        // Every other language, by name, with a search (a service may hear ~100).
        <>
          <label className="vu-search">
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder={l.searchLanguages}
              aria-label={l.searchLanguages}
              value={find}
              onChange={(e) => setFind(e.currentTarget.value)}
            />
          </label>
          <Chips
            label={l.moreLanguages}
            value={language}
            options={offered
              .slice(2)
              .map((code) => ({ value: code, label: languageName(code) }))
              .filter((o) => o.label.toLowerCase().includes(find.trim().toLowerCase()))
              .sort((a, b) => a.label.localeCompare(b.label))}
            // Picked: the list closes; the language shows next to the first ones.
            onChange={(code) => {
              pick(code);
              setAllLanguages(false);
              setFind('');
            }}
          />
        </>
      ) : null}
      {takesWords ? (
        <label className="vu-field vu-text-field">
          <span>{l.captionVocabulary}</span>
          <input
            type="text"
            value={vocabulary}
            placeholder={l.captionVocabularyHint}
            onChange={(e) => {
              setVocabulary(e.currentTarget.value);
              store(wordsKey, e.currentTarget.value);
            }}
          />
        </label>
      ) : null}
      {job ? (
        <div className="vu-caption-job" role="status" aria-live="polite">
          <div className="vu-caption-job-head">
            <span className="vu-spinner" aria-hidden="true" />
            <span>
              {job.stage === 'download' && job.total
                ? l.captionsDownloading((job.loaded ?? 0) / 1e6, job.total / 1e6)
                : job.stage === 'transcribe'
                  ? l.captionsTranscribing(Math.round(job.fraction * 100))
                  : l.captionsListening}
            </span>
            <Button
              label={l.captionsCancel}
              variant="secondary"
              onClick={() => ctl.cancelCaptions()}
            />
          </div>
          <div className="vu-progress" aria-hidden="true">
            <div
              className="vu-progress-fill"
              style={{ width: `${Math.round(Math.max(0.02, job.fraction) * 100)}%` }}
            />
          </div>
        </div>
      ) : (
        <>
          <Button
            icon="captions"
            label={has ? l.remakeCaptions : l.makeCaptions}
            variant="primary"
            disabledReason={
              check && !check.available
                ? (check.reason ?? l.captionsUnavailable)
                : duration === 0
                  ? l.needClips
                  : null
            }
            onClick={() =>
              void ctl.autoCaptions(language, {
                ...(takesWords ? { vocabulary: wordList(vocabulary) } : {}),
              })
            }
          />
          {check && !check.available ? (
            <p className="vu-hint" role="note">
              {check.reason ?? l.captionsUnavailable}
            </p>
          ) : null}
          {check?.available ? (
            <p className="vu-hint">
              {check.onDevice
                ? check.downloadMB
                  ? l.captionsOnDevice(check.downloadMB)
                  : l.captionsOnDeviceCached
                : l.captionsByHost}
              {minutes !== null ? ` · ${l.captionsAbout(minutes)}` : ''}
            </p>
          ) : null}
          {check?.available && check.memoryRisk ? (
            <p className="vu-hint" role="note">
              {l.captionsMemoryRisk}
            </p>
          ) : null}
          {has ? <p className="vu-hint">{l.captionsReplaceNote}</p> : null}
        </>
      )}
    </Section>
  );
}

function CaptionSources(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="vu-caption-sources">
      <Button
        icon="download"
        label={l.importCaptions}
        tip={l.importCaptionsTip}
        variant="secondary"
        onClick={() => input.current?.click()}
      />
      <Button
        icon="plus"
        label={l.addCaption}
        tip={l.addCaptionTip}
        variant="secondary"
        onClick={() => ctl.addCaptionHere()}
      />
      <input
        ref={input}
        type="file"
        accept=".srt,.vtt,text/vtt,application/x-subrip"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void ctl.importSubtitles(file);
        }}
      />
    </div>
  );
}

const HIGHLIGHTS: CaptionLook['highlight'][] = ['none', 'word', 'box', 'fill', 'reveal', 'type'];

function CaptionLookControls(): ReactElement | null {
  const ctl = useController();
  const l = useLabels();
  const look = useProject((p) => captionTrack(p)?.caption ?? null);
  const first = useProject((p) => {
    const item = captionTrack(p)?.items[0];
    return item && item.kind === 'text' ? item : null;
  });
  if (!first) return null;
  const highlightLabel: Record<CaptionLook['highlight'], string> = {
    none: l.highlightNone,
    word: l.highlightWord,
    box: l.highlightBox,
    fill: l.highlightFill,
    reveal: l.highlightReveal,
    type: l.highlightType,
  };
  const y = first.transform.y;
  const place = y < 0.33 ? 'top' : y < 0.66 ? 'middle' : 'bottom';
  return (
    <>
      <Section title={l.captionStyles}>
        <div className="vu-caption-presets" role="radiogroup" aria-label={l.captionStyles}>
          {CAPTION_PRESETS.map((preset) => (
            <PresetTile
              key={preset.id}
              preset={preset}
              selected={look?.preset === preset.id}
              onPick={() => ctl.setCaptionLook({ preset })}
            />
          ))}
        </div>
      </Section>
      <Section title={l.captionHighlight}>
        <Chips
          label={l.captionHighlight}
          hideLabel
          value={look?.highlight ?? 'none'}
          options={HIGHLIGHTS.map((h) => ({ value: h, label: highlightLabel[h] }))}
          onChange={(highlight) => ctl.setCaptionLook({ highlight })}
        />
        {look &&
        look.highlight !== 'none' &&
        look.highlight !== 'reveal' &&
        look.highlight !== 'type' ? (
          <ColorField
            label={l.highlightColour}
            value={look.highlightColor}
            commitLabel={l.captionStyle}
            coalesceKey="caption-highlight-colour"
            recipe={(d, color) => {
              const t = captionTrack(d);
              if (t?.caption) t.caption.highlightColor = color;
            }}
          />
        ) : null}
      </Section>
      <Section title={l.captionPosition}>
        <Segmented
          label={l.captionPosition}
          hideLabel
          value={place}
          options={[
            { value: 'top', label: l.captionTop },
            { value: 'middle', label: l.captionMiddle },
            { value: 'bottom', label: l.captionBottom },
          ]}
          onChange={(v) =>
            ctl.setCaptionLook({ y: v === 'top' ? 0.16 : v === 'middle' ? 0.5 : 0.82 })
          }
        />
        <Segmented
          label={l.captionSize}
          value={first.transform.scale < 0.9 ? 's' : first.transform.scale > 1.2 ? 'l' : 'm'}
          options={[
            { value: 's', label: 'S' },
            { value: 'm', label: 'M' },
            { value: 'l', label: 'L' },
          ]}
          onChange={(v) => ctl.setCaptionLook({ scale: v === 's' ? 0.8 : v === 'm' ? 1 : 1.35 })}
        />
      </Section>
    </>
  );
}

/** A preset as a tile: "Aa" drawn in its style (CSS approximation; the engine draws the real thing). */
function PresetTile({
  preset,
  selected,
  onPick,
}: {
  preset: CaptionPreset;
  selected: boolean;
  onPick: () => void;
}): ReactElement {
  const s = preset.style;
  const css: React.CSSProperties = {
    fontFamily: s.fontFamily,
    fontWeight: s.fontWeight,
    color: s.color,
  };
  if (s.outline) {
    css.WebkitTextStroke = `${Math.max(1, s.outline.width * 18)}px ${s.outline.color}`;
    css.paintOrder = 'stroke fill';
  }
  if (s.shadow) css.textShadow = `0 1px ${s.shadow.blur / 2}px ${s.shadow.color}`;
  if (s.background) {
    css.background = s.background.color;
    css.padding = '0.1em 0.35em';
    css.borderRadius = '0.25em';
  }
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className="vu-caption-preset"
      data-selected={selected || undefined}
      onClick={onPick}
    >
      <span className="vu-caption-preset-sample" style={css}>
        Aa{' '}
        <span style={preset.highlight === 'none' ? undefined : { color: preset.highlightColor }}>
          bc
        </span>
      </span>
      <span className="vu-caption-preset-name">{preset.label}</span>
    </button>
  );
}

function CaptionList(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const items = useProject(
    (p) =>
      (captionTrack(p)?.items.filter((i): i is TextItem => i.kind === 'text') ?? []) as TextItem[],
  );
  const selectedId = useUi((s) => s.selectedId);
  const editing = useUi((s) => s.captionEditing);
  const unsure = items.filter((i) => i.unsure).length;
  return (
    <Section title={l.captionList} collapsible defaultOpen>
      {unsure ? (
        <div className="vu-caption-check" role="note">
          <Icon name="warning" size={16} />
          <span>{l.captionsToCheck(unsure)}</span>
          <Button
            label={l.nextToCheck}
            variant="secondary"
            onClick={() => ctl.nextCaptionToCheck()}
          />
        </div>
      ) : null}
      <ol className="vu-caption-list">
        {items.map((item, i) => (
          <CaptionRow
            key={item.id}
            item={item}
            selected={selectedId === item.id}
            focus={editing === item.id}
            last={i === items.length - 1}
            onFocusDone={() => ctl.ui.setState({ captionEditing: null })}
          />
        ))}
      </ol>
    </Section>
  );
}

function CaptionRow({
  item,
  selected,
  focus,
  last,
  onFocusDone,
}: {
  item: TextItem;
  selected: boolean;
  focus: boolean;
  last: boolean;
  onFocusDone: () => void;
}): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focus) return;
    ref.current?.focus();
    ref.current?.select();
    onFocusDone();
  }, [focus, onFocusDone]);
  const commit = (value: string) => {
    if (value.replace(/\s+/g, ' ').trim() !== item.text && value.trim())
      ctl.setCaptionText(item.id, value);
  };
  const canHear = !!ctl.options.transcriber;
  return (
    <li
      className="vu-caption-row"
      data-selected={selected || undefined}
      data-unsure={item.unsure || undefined}
    >
      <button
        type="button"
        className="vu-caption-time"
        aria-label={
          item.unsure
            ? `${l.captionAt(formatClock(item.start))}. ${l.captionUnsure}`
            : l.captionAt(formatClock(item.start))
        }
        data-tooltip={item.unsure ? l.captionUnsure : undefined}
        onClick={() => {
          ctl.select(item.id, { keepPanel: true });
          ctl.seek(item.start);
        }}
      >
        {item.unsure ? <Icon name="warning" size={12} /> : null}
        {formatClock(item.start)}
      </button>
      <textarea
        ref={ref}
        className="vu-caption-text"
        aria-label={l.captionAt(formatClock(item.start))}
        defaultValue={item.text}
        key={item.text}
        rows={1}
        onFocus={() => {
          ctl.select(item.id, { keepPanel: true });
          ctl.seek(item.start);
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            e.currentTarget.value = item.text;
            e.currentTarget.blur();
          }
        }}
      />
      <div className="vu-caption-actions">
        {item.unsure ? (
          <IconButton
            icon="check"
            label={l.captionChecked}
            tip={l.captionCheckedTip}
            onClick={() => ctl.markCaptionChecked(item.id)}
          />
        ) : null}
        {canHear ? (
          <IconButton
            icon="captions"
            label={l.hearAgain}
            tip={l.hearAgainTip}
            onClick={() => ctl.hearCaptionAgain(item.id)}
          />
        ) : null}
        <IconButton
          icon="split"
          label={l.split}
          tip={l.splitCaptionTip}
          onClick={() => {
            ctl.select(item.id, { keepPanel: true });
            ctl.split();
          }}
        />
        <IconButton
          icon="merge"
          label={l.mergeCaptions}
          tip={l.mergeCaptionsTip}
          disabledReason={last ? l.mergeCaptionsTip : null}
          onClick={() => ctl.mergeCaption(item.id)}
        />
        <IconButton
          icon="delete"
          label={l.deleteCaption}
          onClick={() => {
            ctl.select(item.id, { keepPanel: true });
            ctl.deleteSelected();
          }}
        />
      </div>
    </li>
  );
}

function CaptionDownload(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  return (
    <Section title={l.downloadCaptions}>
      <p className="vu-hint">{l.downloadCaptionsTip}</p>
      <div className="vu-caption-sources">
        <Button
          icon="download"
          label={l.downloadSrt}
          variant="secondary"
          onClick={() => ctl.downloadSubtitles('srt')}
        />
        <Button
          icon="download"
          label={l.downloadVtt}
          variant="secondary"
          onClick={() => ctl.downloadSubtitles('vtt')}
        />
      </div>
    </Section>
  );
}
