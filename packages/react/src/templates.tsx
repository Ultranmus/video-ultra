import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_PRESETS,
  fillTemplateText,
  type TemplateElement,
  type TemplatePreset,
  type TextStyle,
} from '@video-ultra/core';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { CategoryBrowser } from './browse';
import { useController, useLabels, useProject } from './context';
import { Icon } from './icons';

/**
 * Templates (v0.3): ready-made titles, lower thirds, quotes… Each tile is a CSS miniature of the
 * template on the project's canvas shape (text sized to the tile — the engine draws the real
 * thing). Picking one asks for its variables (examples filled in), then adds it at the playhead
 * as one group.
 */

/** CSS for one element in a miniature (sizes in container-height units of the frame). */
function elementCss(el: TemplateElement): CSSProperties {
  const css: CSSProperties = {
    left: `${el.x * 100}%`,
    top: `${el.y * 100}%`,
    transform: `translate(-50%, -50%)${el.rotation ? ` rotate(${el.rotation}deg)` : ''}`,
  };
  if (el.kind === 'emoji') {
    css.fontSize = `${(el.scale ?? 0.15) * 100}cqmin`;
    return css;
  }
  const s: Partial<TextStyle> = el.style ?? {};
  const size = s.size ?? 0.06;
  css.fontSize = `${size * 100}cqh`;
  css.fontFamily = s.fontFamily;
  css.fontWeight = s.fontWeight;
  css.color = s.color;
  css.letterSpacing = `${s.letterSpacing ?? 0}em`;
  css.lineHeight = s.lineHeight ?? 1.2;
  css.textAlign = s.align ?? 'center';
  if (el.maxWidth) css.width = `${el.maxWidth * 100}%`;
  if (s.outline) {
    css.WebkitTextStroke = `${s.outline.width * 2}em ${s.outline.color}`;
    css.paintOrder = 'stroke fill';
  }
  if (s.shadow)
    css.textShadow = `${s.shadow.x * 0.05}em ${s.shadow.y * 0.05}em ${s.shadow.blur * 0.05}em ${s.shadow.color}`;
  if (s.background) {
    css.background = s.background.color;
    css.padding = `${s.background.padding * 0.6}em ${s.background.padding}em`;
    css.borderRadius = `${s.background.radius}em`;
  }
  return css;
}

function Miniature({
  template,
  aspect,
  values,
}: {
  template: TemplatePreset;
  aspect: string;
  values?: Readonly<Record<string, string>>;
}): ReactElement {
  return (
    <span className="vu-template-frame" style={{ aspectRatio: aspect }} aria-hidden="true">
      {template.elements.map((el, i) => (
        <span key={i} className="vu-template-el" data-kind={el.kind} style={elementCss(el)}>
          {fillTemplateText(el.content, template, values)}
        </span>
      ))}
    </span>
  );
}

/** The form for a template's variables, then Add. */
function TemplateForm({
  template,
  aspect,
  onBack,
}: {
  template: TemplatePreset;
  aspect: string;
  onBack: () => void;
}): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(template.variables.map((x) => [x.key, x.example])),
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // The grid was scrolled: start the form at its top (the panel only, not the page).
    let node = ref.current?.parentElement ?? null;
    while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
    if (node) node.scrollTop = 0;
    // Touch screens: no keyboard until the person taps a field (it would cover the preview).
    if (!matchMedia('(pointer: coarse)').matches)
      ref.current?.querySelector('input')?.focus({ preventScroll: true });
  }, []);
  return (
    <form
      ref={ref}
      className="vu-template-form"
      onSubmit={(e) => {
        e.preventDefault();
        ctl.addTemplate(template, values);
        onBack();
      }}
    >
      <div className="vu-template-form-head">
        <button type="button" className="vu-icon-btn" aria-label={l.back} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h3 className="vu-template-form-title">{template.name}</h3>
      </div>
      <div className="vu-template-preview">
        <Miniature template={template} aspect={aspect} values={values} />
      </div>
      {template.variables.map((variable) => (
        <label key={variable.key} className="vu-field vu-template-field">
          <span>{variable.label}</span>
          <input
            type="text"

            value={values[variable.key] ?? ''}
            onChange={(e) => {
              const value = e.currentTarget.value;
              setValues((v) => ({ ...v, [variable.key]: value }));
            }}
          />
        </label>
      ))}
      <button type="submit" className="vu-btn vu-wide" data-variant="primary" data-layout="row">
        <Icon name="plus" />
        <span>{l.addTemplate}</span>
      </button>
    </form>
  );
}

/** The Templates panel: every template by category; tap → fill in → add. */
export function TemplatesPanel(): ReactElement {
  const ctl = useController();
  const l = useLabels();
  const [chosen, setChosen] = useState<TemplatePreset | null>(null);
  const aspect = useProject((p) => `${p.settings.width} / ${p.settings.height}`);
  const categories = useMemo(
    () => TEMPLATE_CATEGORIES.map((id) => ({ id, label: l.templateCategory(id) })),
    [l],
  );
  if (chosen)
    return (
      <div className="vu-panel-body">
        <TemplateForm template={chosen} aspect={aspect} onBack={() => setChosen(null)} />
      </div>
    );
  return (
    <div className="vu-panel-body">
      <p className="vu-hint">{l.templatesHint}</p>
      <CategoryBrowser label={l.category} categories={categories}>
        {(c) => (
          <ul className="vu-template-grid" aria-label={c.label}>
            {TEMPLATE_PRESETS.filter((t) => t.category === c.id).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="vu-template"
                  aria-label={t.name}
                  data-tooltip={t.name}
                  onClick={() => {
                    if (t.variables.length === 0) ctl.addTemplate(t, {});
                    else setChosen(t);
                  }}
                >
                  <Miniature template={t} aspect={aspect} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CategoryBrowser>
    </div>
  );
}
