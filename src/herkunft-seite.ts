/**
 * Herkunft (docs/SPEC-herkunft.md) for pages without their own script: ueber.html, presse.html (Vite
 * entries) and the static level pages (tools/levelseiten/bauen.mjs bundles this file to
 * level/herkunft.js, one small file without imports). Same rules and same sessionStorage marker as the
 * game, so a visitor who comes from a level page into the game is counted once.
 */
import { browserHerkunft, herkunftMelden } from './herkunft';

herkunftMelden(browserHerkunft());
