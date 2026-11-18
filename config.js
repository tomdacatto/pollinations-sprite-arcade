// What a visitor's key may spend and for how long. A game with three sprites costs one to two cents.
export const BUDGET = 0.3;
export const EXPIRY_DAYS = 1;

// Both are free for every visitor (paid_only is false on /v1/models).
export const CODE_MODEL = "openai/gpt-6-luna"; // writes the game and plans its sprites
export const IMAGE_MODEL = "zimage"; // draws each sprite

export const SPRITE_SIZE = 256; // pixels, square
export const MAX_SPRITES = 4;

// The publishable App Key (pk_...), sent as client_id so the consent screen names the app. Empty until it exists.
export const APP_KEY = "";
