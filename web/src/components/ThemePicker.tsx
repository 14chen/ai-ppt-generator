import { getPlayer } from '../lib/player';
import type { PlayerTheme } from '../lib/player';

interface Props {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

function swatchStyle(theme: PlayerTheme): React.CSSProperties {
  const v = theme.vars;
  return {
    background: `linear-gradient(135deg, ${v['ppt-slide-bg']} 0%, ${v['ppt-slide-bg2']} 55%, ${v['ppt-accent']} 100%)`,
    borderColor: v['ppt-line']
  };
}

export function ThemePicker({ value, onChange, disabled, compact }: Props) {
  let themes: PlayerTheme[] = [];
  try {
    themes = getPlayer().THEMES;
  } catch {
    themes = [];
  }

  return (
    <div className={`theme-picker${compact ? ' theme-picker-compact' : ''}`} role="radiogroup" aria-label="配色主题">
      {themes.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={value === t.id}
          className={`theme-chip${value === t.id ? ' is-active' : ''}`}
          onClick={() => onChange(t.id)}
          disabled={disabled}
          title={`切换到「${t.label}」主题`}
          data-testid={`theme-${t.id}`}
        >
          <span className="theme-swatch" style={swatchStyle(t)} aria-hidden="true" />
          <span className="theme-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
