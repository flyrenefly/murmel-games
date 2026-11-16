// A loading error of parseLevel ("id: " already stripped or not) in the page's language. The error
// message itself stays German: the server's checker and its translation (server/src/fehler-en.ts) rely on it.
import { musterUebersetzen, sprache } from '../i18n';
import EN from '../i18n/en/ladefehler';

export function ladefehler(msg: string): string {
  return sprache() === 'en' ? musterUebersetzen(msg, EN) : msg;
}
