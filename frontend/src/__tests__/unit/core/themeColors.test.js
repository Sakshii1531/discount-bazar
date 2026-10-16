import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  applyCachedThemeColors,
  applyThemeVariables,
  normalizeHexColor,
  readableTextColor,
  resolveThemeColors,
} from '@core/context/SettingsDefaults';
import { STORAGE_KEYS, getJSON } from '@core/utils/storage';

const cssVar = (name) => document.documentElement.style.getPropertyValue(name);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
});

describe('brand colours: parsing', () => {
  it('normalises 3- and 6-digit hex codes', () => {
    expect(normalizeHexColor('#08F7A7')).toBe('#08f7a7');
    expect(normalizeHexColor(' 08f7a7 ')).toBe('#08f7a7');
    expect(normalizeHexColor('#0f8')).toBe('#00ff88');
  });

  it('rejects anything that is not a hex colour', () => {
    for (const bad of ['', null, undefined, 'red', '#12', '#1234567', 'var(--primary)', 'rgb(0,0,0)', '#ggg']) {
      expect(normalizeHexColor(bad)).toBeNull();
    }
  });

  it('picks readable text for light and dark backgrounds', () => {
    expect(readableTextColor('#08f7a7')).toBe('#000000'); // bright green
    expect(readableTextColor('#ffff00')).toBe('#000000');
    expect(readableTextColor('#e41d07')).toBe('#ffffff'); // red
    expect(readableTextColor('#0284c7')).toBe('#ffffff');
    expect(readableTextColor('#0f8')).toBe('#000000');
  });

  it('falls back to the defaults for missing or invalid colours', () => {
    expect(resolveThemeColors({})).toEqual({ primary: DEFAULT_PRIMARY_COLOR, secondary: DEFAULT_SECONDARY_COLOR });
    expect(resolveThemeColors({ primaryColor: 'var(--primary)', secondaryColor: 'blue' }))
      .toEqual({ primary: DEFAULT_PRIMARY_COLOR, secondary: DEFAULT_SECONDARY_COLOR });
  });
});

describe('brand colours: applying', () => {
  it('sets the theme variables with readable foregrounds', () => {
    applyThemeVariables({ primaryColor: '#08f7a7', secondaryColor: '#e41d07' });
    expect(cssVar('--primary')).toBe('#08f7a7');
    expect(cssVar('--primary-color')).toBe('#08f7a7');
    expect(cssVar('--primary-foreground')).toBe('#000000');
    expect(cssVar('--ring')).toBe('#08f7a7');
    expect(cssVar('--secondary')).toBe('#e41d07');
    expect(cssVar('--secondary-foreground')).toBe('#ffffff');
  });

  it('never writes an invalid value into the theme', () => {
    applyThemeVariables({ primaryColor: 'var(--primary)', secondaryColor: 'not-a-colour' });
    expect(cssVar('--primary')).toBe(DEFAULT_PRIMARY_COLOR);
    expect(cssVar('--secondary')).toBe(DEFAULT_SECONDARY_COLOR);
  });

  it('remembers saved colours and re-applies them on the next load', () => {
    applyThemeVariables({ primaryColor: '#08f7a7', secondaryColor: '#e41d07' });
    expect(getJSON(STORAGE_KEYS.THEME_COLORS)).toEqual({ primary: '#08f7a7', secondary: '#e41d07' });

    document.documentElement.removeAttribute('style'); // a fresh page load
    applyCachedThemeColors();
    expect(cssVar('--primary')).toBe('#08f7a7');
    expect(cssVar('--secondary')).toBe('#e41d07');
  });

  it('does not remember a live preview', () => {
    applyThemeVariables({ primaryColor: '#08f7a7' });
    applyThemeVariables({ primaryColor: '#123456' }, { persist: false });
    expect(cssVar('--primary')).toBe('#123456');
    expect(getJSON(STORAGE_KEYS.THEME_COLORS).primary).toBe('#08f7a7');
  });

  it('leaves the stylesheet defaults when nothing was cached', () => {
    applyCachedThemeColors();
    expect(cssVar('--primary')).toBe('');
  });
});
