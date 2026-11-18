// The rules of the forge, with no network and no page, so they can be tested alone: what is asked of the model,
// how its reply is checked, how a sprite is cut out of its background, and how a game becomes one shareable file.
import { MAX_SPRITES } from "./config.js";

const NAME = /^[a-z][a-z0-9_]{0,15}$/;
const MAX_HTML = 60_000;

export function gameMessages(description) {
    return [
        {
            role: "system",
            content:
                "You write small browser games. Reply in exactly this form and nothing else.\n" +
                `First a line "SPRITES:" and then up to ${MAX_SPRITES} lines "- name: image prompt". A name is lowercase letters, digits or underscore, ` +
                "at most 16 characters. An image prompt describes ONE object, flat colours, no background, no text.\n" +
                "Then one fenced block ```html holding the whole game as a single self-contained HTML file: a <canvas> about 640 by 480, " +
                "controls written on screen (arrow keys or WASD, space, mouse), a visible score, a game over screen with a restart key, " +
                "no libraries and no network requests, under 250 lines.\n" +
                "Each sprite is already loaded as window.SPRITES.<name>, an image with a transparent background: draw it with ctx.drawImage. " +
                "Use only the sprite names you listed. Make the game fun in the first ten seconds.",
        },
        { role: "user", content: `The game: ${description}` },
    ];
}

/** The messages that ask for a repaired or changed game: the conversation so far (ending with the model's last reply) plus the request. */
export function changeMessages(previous, request) {
    return [
        ...previous,
        {
            role: "user",
            content:
                `${request}\nReply with the complete corrected game in one fenced \`\`\`html block and nothing else. ` +
                "Keep using the same sprite names.",
        },
    ];
}

const fenced = (reply) => String(reply).match(/```html\s*\n([\s\S]*?)```/i)?.[1] ?? null;
const used = (html) =>
    [...html.matchAll(/SPRITES(?:\.([a-z][a-z0-9_]*)|\[\s*["']([^"']+)["']\s*\])/g)].map((m) => m[1] ?? m[2]);

/** Reads the model's reply. Returns { sprites, html } or { error, sprites } with a sentence the model or the user can act on. */
export function parseGame(reply, known) {
    const sprites = known ?? [];
    if (!known) {
        for (const line of String(reply)
            .split(/```html/i)[0]
            .split(/\r?\n/)) {
            const m = line.match(/^\s*-\s*([^:\s]+)\s*:\s*(.+?)\s*$/);
            if (m && NAME.test(m[1]) && !sprites.some((s) => s.name === m[1]) && sprites.length < MAX_SPRITES)
                sprites.push({ name: m[1], prompt: m[2].slice(0, 200) });
        }
    }
    const html = fenced(reply);
    if (!html) return { error: "The model did not return a game in an html block.", sprites };
    if (html.length > MAX_HTML) return { error: "The game came back too large to run.", sprites };
    if (!/<canvas|<body/i.test(html)) return { error: "The model's game has no canvas or body.", sprites };
    const missing = [...new Set(used(html))].filter((name) => !sprites.some((s) => s.name === name));
    if (missing.length) return { error: `The game uses sprites that were not listed: ${missing.join(", ")}.`, sprites };
    return { sprites, html };
}

/**
 * Turns a flat magenta background into transparency, in place, on RGBA bytes. A pixel is background when its
 * red and blue are both well above its green; the edge is feathered and de-fringed so no pink halo is left.
 */
export function keyMagenta(pixels) {
    for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        const magenta = Math.min(r, b) - g;
        if (magenta <= 30) continue;
        if (magenta >= 90) pixels[i + 3] = 0;
        else {
            pixels[i + 3] = Math.round((255 * (90 - magenta)) / 60);
            pixels[i] = Math.min(r, g + 30); // pull the pink out of the edge
            pixels[i + 2] = Math.min(b, g + 30);
        }
    }
    return pixels;
}

const HOOK = `<script>addEventListener("error",function(e){parent.postMessage({kind:"error",message:e.message,line:e.lineno},"*")});</script>`;

/** The page that runs a game: the sprites as loaded images and an error hook, ahead of the model's own HTML. */
export function buildPage(html, sprites) {
    const data = JSON.stringify(sprites).replace(/</g, "\\u003c");
    const prelude = `${HOOK}<script>window.SPRITES={};(function(d){for(var k in d){var i=new Image();i.src=d[k];SPRITES[k]=i}})(${data});</script>`;
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (tag) => `${tag}${prelude}`);
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${prelude}</head>`);
    return `<!doctype html><meta charset="utf-8">${prelude}${html}`;
}

const toBase64Url = (bytes) => {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromBase64Url = (text) =>
    Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
}

/** A whole game page as text that fits in a URL fragment. The page is already self-contained. */
export async function encodeShare(page) {
    return toBase64Url(await pipe(new TextEncoder().encode(page), new CompressionStream("deflate-raw")));
}

export async function decodeShare(text) {
    return new TextDecoder().decode(await pipe(fromBase64Url(text), new DecompressionStream("deflate-raw")));
}
