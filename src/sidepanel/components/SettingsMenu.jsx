/* SettingsMenu.jsx — accent / Chinese face / tone-color popover, ported from panel.jsx. */
import React from 'react'

const ACCENTS = [
  { c: '#c8443a', n: 'Vermilion' }, { c: '#2f6f4f', n: 'Jade' },
  { c: '#3b5b8c', n: 'Indigo' }, { c: '#b5862f', n: 'Gold' }, { c: '#4a4540', n: 'Ink' },
]

export function SettingsMenu({ settings, onSetting, onPdfAutoOpen, onClose }) {
  return (
    <>
      <div className="set-overlay" onClick={onClose} />
      <div className="settings-pop" role="dialog" aria-label="Display settings">
        <div className="set-title">Display</div>

        <div className="set-row col">
          <span className="set-label">Accent</span>
          <div className="swatches">
            {ACCENTS.map(({ c, n }) => (
              <button key={c} title={n} aria-label={n}
                className={'swatch' + (settings.accent === c ? ' on' : '')}
                style={{ background: c }} onClick={() => onSetting('accent', c)}>
                {settings.accent === c && <span className="sw-check">✓</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="set-row">
          <span className="set-label">Chinese face</span>
          <div className="segmini">
            <button className={settings.hanFont === 'sans' ? 'on' : ''}
              onClick={() => onSetting('hanFont', 'sans')}>Sans</button>
            <button className={settings.hanFont === 'serif' ? 'on' : ''}
              onClick={() => onSetting('hanFont', 'serif')}>Serif</button>
          </div>
        </div>

        <div className="set-row">
          <span className="set-label">Pinyin tone colors</span>
          <button className={'switch' + (settings.toneColors ? ' on' : '')}
            role="switch" aria-checked={settings.toneColors}
            onClick={() => onSetting('toneColors', !settings.toneColors)}>
            <span className="knob" />
          </button>
        </div>

        <div className="set-row">
          <span className="set-label">Traditional form (繁)</span>
          <button className={'switch' + (settings.showTrad ? ' on' : '')}
            role="switch" aria-checked={settings.showTrad}
            onClick={() => onSetting('showTrad', !settings.showTrad)}>
            <span className="knob" />
          </button>
        </div>

        <div className="set-row">
          <span className="set-label">Inline popup on hover</span>
          <button className={'switch' + (settings.inlinePopup ? ' on' : '')}
            role="switch" aria-checked={settings.inlinePopup}
            onClick={() => onSetting('inlinePopup', !settings.inlinePopup)}>
            <span className="knob" />
          </button>
        </div>

        <div className="set-row">
          <span className="set-label">Familiarity tags</span>
          <button className={'switch' + (settings.showFamiliarity ? ' on' : '')}
            role="switch" aria-checked={settings.showFamiliarity}
            onClick={() => onSetting('showFamiliarity', !settings.showFamiliarity)}>
            <span className="knob" />
          </button>
        </div>

        <div className="set-row">
          <span className="set-label">Show HSK meaning first</span>
          <button className={'switch' + (settings.hskFirst ? ' on' : '')}
            role="switch" aria-checked={settings.hskFirst}
            onClick={() => onSetting('hskFirst', !settings.hskFirst)}>
            <span className="knob" />
          </button>
        </div>

        <div className="set-row col">
          <div className="set-row" style={{ width: '100%' }}>
            <span className="set-label">Open all PDFs automatically</span>
            <button className={'switch' + (settings.pdfAutoOpen ? ' on' : '')}
              role="switch" aria-checked={!!settings.pdfAutoOpen}
              onClick={() => onPdfAutoOpen(!settings.pdfAutoOpen)}>
              <span className="knob" />
            </button>
          </div>
          <span className="set-sub">
            Opens PDFs in Zilense’s hover viewer instead of Chrome’s (so you can
            hover characters). Replaces Chrome’s built-in PDF viewer. Local
            (file://) PDFs also need “Allow access to file URLs” enabled for Zilense.
          </span>
        </div>

        <div className="set-row">
          <span className="set-label">Pin key (hover&nbsp;+&nbsp;press)</span>
          <input className="keycap" type="text" maxLength={1} value={settings.pinKey}
            aria-label="Pin key" spellCheck={false}
            onChange={(e) => onSetting('pinKey', (e.target.value || 'p').slice(-1).toLowerCase())} />
        </div>

        <p className="set-privacy">
          Dictionary lookups and your saved words stay on this device. Example
          sentences (Tatoeba) and stroke-order data (jsDelivr) are fetched from
          the network only when you expand those sections.
        </p>

        <p className="set-privacy set-credits">
          Data: CC-CEDICT (CC BY-SA 4.0) · CedPane (public domain) · makemeahanzi
          · Tatoeba · Fonts: Noto SC / Source Serif 4 (OFL).{' '}
          <a className="set-licenses" target="_blank" rel="noreferrer"
            href={(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
              ? chrome.runtime.getURL('THIRD-PARTY-NOTICES.md')
              : 'https://github.com/dsaad68/zilense/blob/main/THIRD-PARTY-NOTICES.md'}>
            Licenses&nbsp;→
          </a>
        </p>
      </div>
    </>
  )
}
