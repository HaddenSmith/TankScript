import { TANK_LANGUAGES } from '../game/tank-script/shared/tankLanguages.js';
import './tank-language-logo.css';

export function TankLanguageLogo({ language, decorative = false }) {
  const entry = TANK_LANGUAGES.find(entry => entry.id === (language ?? 'javascript')) ?? TANK_LANGUAGES[0];
  return <img className="tank-language-logo" src={entry.logo} alt={decorative ? '' : entry.name} title={entry.name} />;
}
